import encode, { init } from '@jsquash/webp/encode.js';
import wasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import simdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';

let initialized;
self.onmessage = async ({ data }) => {
  const { id, width, height, quality, pixels } = data ?? {};
  try {
    if (!Number.isInteger(id) || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4_194_304
      || !(pixels instanceof ArrayBuffer) || pixels.byteLength !== width * height * 4
      || !Number.isFinite(quality) || quality < 0 || quality > 100) throw new Error('webp_encoder_dimensions');
    initialized ??= init({ locateFile: name => name.includes('_simd') ? simdWasm : wasm });
    await initialized;
    const bytes = await encode({ width, height, data: new Uint8ClampedArray(pixels), colorSpace: 'srgb' },
      { quality, method: 4, thread_level: 0 });
    self.postMessage({ id, ok: true, bytes }, [bytes]);
  } catch {
    initialized = undefined;
    self.postMessage({ id, ok: false });
  }
};
