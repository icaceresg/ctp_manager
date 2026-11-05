// A normalized club logo is a static 8-bit RGBA PNG, at most 512 x 512.
// Check decoded pixels: an alpha-capable header alone does not prove a clear background.
export class LogoPngError extends Error {
  constructor(code = 'format') { super(code); this.code = code; }
}
const fail = code => { throw new LogoPngError(code); };
const label = (bytes, start) => String.fromCharCode(...bytes.subarray(start, start + 4));
export function pngCrc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
async function boundedInflate(bytes, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); fail('format'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

/** Metadata is never trusted for transparency. Inflation has a strict output budget. */
export async function requireTransparentLogoPng(bytes, { inflate = boundedInflate } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > 2 * 1024 * 1024
    || ![137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) fail('format');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, ended = false, idatClosed = false, idatSeen = false;
  const compressed = []; let compressedBytes = 0, count = 0, at = 8;
  while (at + 12 <= bytes.length) {
    if (++count > 4096) fail('format');
    const size = view.getUint32(at), name = label(bytes, at + 4), start = at + 8, end = start + size;
    if (end + 4 > bytes.length || !/^[A-Za-z]{4}$/.test(name)
      || pngCrc32(bytes.subarray(at + 4, end)) !== view.getUint32(end)) fail('format');
    if (count === 1 && name !== 'IHDR') fail('format');
    if (name === 'IHDR') {
      if (count !== 1 || size !== 13) fail('format');
      width = view.getUint32(start); height = view.getUint32(start + 4);
      if (!width || !height || width > 512 || height > 512 || bytes[start + 8] !== 8
        || bytes[start + 9] !== 6 || bytes[start + 10] || bytes[start + 11] || bytes[start + 12]) fail('format');
    } else if (name === 'IDAT') {
      if (idatClosed || !width) fail('format');
      idatSeen = true; compressed.push(bytes.subarray(start, end)); compressedBytes += size;
    } else {
      if (idatSeen) idatClosed = true;
      if (name === 'IEND') {
        if (size || !idatSeen || end + 4 !== bytes.length) fail('format');
        ended = true; at = end + 4; break;
      }
      if (['acTL', 'fcTL', 'fdAT'].includes(name) || name[0] === name[0].toUpperCase()) fail('format');
    }
    at = end + 4;
  }
  if (!ended || at !== bytes.length || !compressedBytes) fail('format');
  const input = new Uint8Array(compressedBytes); let offset = 0;
  for (const chunk of compressed) { input.set(chunk, offset); offset += chunk.length; }
  const stride = width * 4, expected = (stride + 1) * height;
  let decoded;
  try { decoded = await inflate(input, expected); } catch { fail('format'); }
  if (!(decoded instanceof Uint8Array) || decoded.length !== expected) fail('format');
  let prior = new Uint8Array(stride), visible = false, clearBorder = false;
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)]; if (filter > 4) fail('format');
    const row = new Uint8Array(stride), start = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0, b = prior[x], c = x >= 4 ? prior[x - 4] : 0;
      row[x] = decoded[start + x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0);
    }
    for (let x = 0; x < width; x++) {
      const alpha = row[x * 4 + 3]; visible ||= alpha > 0;
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && alpha === 0) clearBorder = true;
    }
    prior = row;
  }
  if (!visible || !clearBorder) fail('transparency');
  return { width, height, mime: 'image/png', hasVisiblePixels: true, hasTransparentBorder: true };
}
