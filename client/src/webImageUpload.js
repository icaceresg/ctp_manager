import { readImageInfo, cleanImageMetadata, ImageFormatError } from '../../shared/image-format.js';
import { translate } from './i18n/runtime.js';
import { encodeWebpFallback } from './webpFallback.js';

export const WEB_IMAGE_SPECS = Object.freeze({
  logo: { width: 512, height: 512, fit: 'contain', kind: 'logo' },
  cover: { width: 1600, height: 600, fit: 'cover' },
  map: { width: 1600, height: 1200, fit: 'contain' },
});
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
function invalid() { throw new Error(translate('manager.images.invalid')); }
function dimensions(width, height) {
  if (!width || !height || width > 12000 || height > 12000 || width * height > 24_000_000)
    throw new Error(translate('manager.images.dimensions'));
}
function sourceInfo(bytes, declared) {
  const info = readImageInfo(bytes, declared === 'image/x-ms-bmp' ? 'image/bmp' : declared);
  if (!['image/png','image/jpeg','image/webp','image/gif','image/bmp','image/avif'].includes(info.mime)) invalid();
  return info;
}
export function logoPixelsClear(image) {
  const { data, width, height } = image; let visible = false, clearBorder = false;
  if (!width || !height || data.length !== width * height * 4) return false;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3]; visible ||= alpha > 0;
    if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && alpha === 0) clearBorder = true;
  }
  return visible && clearBorder;
}
async function resultFor(blob, width, height) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return { base64: btoa(binary), contentType: blob.type, size: blob.size, width, height, blob };
}

/** Browser-only conversion; uploads contain the actual encoded MIME and bytes. */
export async function prepareWebImage(file, spec = WEB_IMAGE_SPECS.map, dependencies = {}) {
  if (!file?.size || file.size > MAX_SOURCE_BYTES) throw new Error(translate('manager.images.sourceSize'));
  let info, original;
  try { original = new Uint8Array(await file.arrayBuffer()); info = sourceInfo(original, file.type); }
  catch (error) {
    if (error instanceof ImageFormatError && error.code === 'dimensions') throw new Error(translate('manager.images.dimensions'));
    invalid();
  }
  if (spec.kind === 'logo' && info.mime !== 'image/png') throw new Error(translate('manager.images.logoPng'));
  if (info.animated && info.mime !== 'image/gif') throw new Error(translate('manager.images.static'));
  const decode = dependencies.decode || ((source) => createImageBitmap(source, { imageOrientation: 'from-image' }));
  const makeCanvas = dependencies.makeCanvas || (() => document.createElement('canvas'));
  let bitmap;
  try { bitmap = await decode(file); } catch { invalid(); }
  try {
    dimensions(bitmap.width, bitmap.height);
    const factor = spec.fit === 'cover'
      ? Math.min(1, bitmap.width / spec.width, bitmap.height / spec.height)
      : Math.min(1, spec.width / bitmap.width, spec.height / bitmap.height);
    const width = Math.max(1, Math.round(spec.fit === 'cover' ? spec.width * factor : bitmap.width * factor));
    const height = Math.max(1, Math.round(spec.fit === 'cover' ? spec.height * factor : bitmap.height * factor));
    if (info.mime === 'image/webp' && info.orientation === 1 && width === bitmap.width && height === bitmap.height) {
      const clean = new Blob([cleanImageMetadata(original, info)], { type: info.mime });
      if (clean.size <= MAX_BYTES) return await resultFor(clean, width, height);
    }
    const canvas = makeCanvas(); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error(translate('manager.images.prepareError'));
    const scale = spec.fit === 'cover' ? Math.max(width / bitmap.width, height / bitmap.height) : factor;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (width - bitmap.width * scale) / 2, (height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    const encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
    if (spec.kind === 'logo') {
      if (!logoPixelsClear(context.getImageData(0, 0, width, height))) throw new Error(translate('manager.images.logoClear'));
      const blob = await encode('image/png');
      if (!blob || blob.type !== 'image/png' || blob.size > MAX_BYTES) throw new Error(translate('manager.images.outputSize'));
      const actual = readImageInfo(new Uint8Array(await blob.arrayBuffer()), blob.type);
      if (actual.mime !== 'image/png' || actual.width !== width || actual.height !== height || actual.animated) invalid();
      return await resultFor(blob, width, height);
    }
    let best = null, nativeUnsupported = false;
    for (const quality of [.86, .74, .64]) {
      const blob = await encode('image/webp', quality);
      if (!blob || blob.type !== 'image/webp') { nativeUnsupported = true; break; }
      try {
        const actual = readImageInfo(new Uint8Array(await blob.arrayBuffer()), blob.type);
        if (actual.mime === 'image/webp' && actual.width === width && actual.height === height && !actual.animated
          && (!best || blob.size < best.size)) best = blob;
      } catch { /* A browser's MIME fallback is checked below as PNG. */ }
      if (best?.size <= MAX_BYTES) break;
    }
    if (!best && nativeUnsupported) {
      try {
        const blob = await (dependencies.encodeWebpFallback || encodeWebpFallback)(canvas, .86);
        const actual = readImageInfo(new Uint8Array(await blob.arrayBuffer()), blob.type);
        if (actual.mime === 'image/webp' && actual.width === width && actual.height === height && !actual.animated) best = blob;
      } catch { /* A failed fallback never sends the original format. */ }
    }
    if (!best) throw new Error(translate('manager.images.webpUnsupported'));
    if (best.size > MAX_BYTES) throw new Error(translate('manager.images.outputSize'));
    return await resultFor(best, width, height);
  } finally { bitmap.close?.(); }
}
