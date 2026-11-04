// Encoder protocol only. This module never sends images to a server or CDN.
const MAX_PIXELS = 4_194_304;
const MAX_SIDE = 4096;
const IDLE_MS = 30_000;
const TIMEOUT_MS = 25_000;
let worker = null;
let serial = Promise.resolve();
let idle;
let sequence = 0;

function dispose() {
  if (idle !== undefined) clearTimeout(idle);
  idle = undefined;
  worker?.terminate();
  worker = null;
}

/** Called only when native canvas encoding does not produce WebP. */
export function encodeWebpFallback(canvas, quality) {
  const task = serial.then(async () => {
    const { width, height } = canvas;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS
      || !Number.isFinite(quality) || quality < 0 || quality > 1) throw new Error('webp_encoder_dimensions');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('webp_encoder_unavailable');
    const pixels = context.getImageData(0, 0, width, height).data;
    if (idle !== undefined) clearTimeout(idle);
    idle = undefined;
    if (!worker) worker = new Worker(new URL('./webpFallback.worker.js', import.meta.url), { type: 'module' });
    const active = worker;
    const id = ++sequence;
    try {
      const bytes = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { dispose(); reject(new Error('webp_encoder_timeout')); }, TIMEOUT_MS);
        const fail = () => { clearTimeout(timer); dispose(); reject(new Error('webp_encoder_unavailable')); };
        active.onerror = fail;
        active.onmessageerror = fail;
        active.onmessage = event => {
          const result = event.data;
          if (result?.id !== id) return;
          clearTimeout(timer);
          active.onerror = null;
          active.onmessageerror = null;
          active.onmessage = null;
          if (result.ok !== true || !(result.bytes instanceof ArrayBuffer)) {
            dispose(); reject(new Error('webp_encoder_unavailable')); return;
          }
          resolve(result.bytes);
        };
        active.postMessage({ id, width, height, quality: quality * 100, pixels: pixels.buffer }, [pixels.buffer]);
      });
      const header = new Uint8Array(bytes);
      if (header.length < 20 || String.fromCharCode(...header.slice(0, 4)) !== 'RIFF'
        || String.fromCharCode(...header.slice(8, 12)) !== 'WEBP'
        || new DataView(bytes).getUint32(4, true) !== bytes.byteLength - 8) throw new Error('webp_encoder_invalid');
      idle = setTimeout(dispose, IDLE_MS);
      return new Blob([bytes], { type: 'image/webp' });
    } catch (error) {
      dispose();
      throw error;
    }
  });
  serial = task.then(() => undefined, () => undefined);
  return task;
}
