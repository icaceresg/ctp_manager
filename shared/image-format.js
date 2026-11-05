// Shared CTP imageFormat.ts binary contract; LF source SHA-256 55fda747e97475db8c4fcb4196960c5cb660572f95e4e59966faf8a2d9df783c
export class ImageFormatError extends Error {
    code;
    constructor(code) { super(code); this.code = code; }
}
const text = (b, at, count) => String.fromCharCode(...b.subarray(at, at + count));
const fail = () => { throw new ImageFormatError(/* i18n-code: private image validation code */ 'format'); };
const bytes = (...parts) => { const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) {
    result.set(p, at);
    at += p.length;
} return result; };
function orientation(data) {
    let at = text(data, 0, 6) === 'Exif\0\0' ? 6 : 0;
    const base = at, view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (at + 8 > data.length)
        return 1;
    const little = text(data, at, 2) === 'II';
    if (!little && text(data, at, 2) !== 'MM')
        return 1;
    if (view.getUint16(at + 2, little) !== 42)
        return 1;
    at = base + view.getUint32(at + 4, little);
    if (at < base + 8 || at + 2 > data.length)
        return 1;
    const count = view.getUint16(at, little);
    at += 2;
    for (let n = 0; n < count && at + 12 <= data.length; n++, at += 12) {
        if (view.getUint16(at, little) === 0x112 && view.getUint16(at + 2, little) === 3 && view.getUint32(at + 4, little) === 1) {
            const value = view.getUint16(at + 8, little);
            return value >= 1 && value <= 8 ? value : 1;
        }
    }
    return 1;
}
function minimalExif(value) {
    // Keep only orientation, never GPS, camera identity, thumbnails or user text.
    const result = new Uint8Array(26), view = new DataView(result.buffer);
    result.set([73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0]);
    view.setUint16(18, value, true);
    return result;
}
/** Only bounded ISO-BMFF containers, never a byte search through compressed pixels. */
function avifDimensions(b) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let branded = false, animated = false, width = 0, height = 0, boxes = 0;
    const visit = (start, end, parent = '', depth = 0) => {
        if (depth > 6)
            return fail();
        for (let at = start; at < end;) {
            if (++boxes > 2048 || at + 8 > end)
                return fail();
            let size = view.getUint32(at), header = 8;
            const type = text(b, at + 4, 4);
            if (size === 1) {
                if (at + 16 > end)
                    return fail();
                const high = view.getUint32(at + 8), low = view.getUint32(at + 12);
                if (high)
                    return fail();
                size = low;
                header = 16;
            }
            else if (size === 0)
                size = end - at;
            if (size < header || at + size > end)
                return fail();
            const payload = at + header, until = at + size;
            if (type === 'ftyp' && parent === '') {
                if (size < header + 8 || (size - header) % 4)
                    return fail();
                for (let p = payload; p + 4 <= until; p += 4)
                    if (p !== payload + 4) {
                        const brand = text(b, p, 4);
                        branded ||= brand === 'avif' || brand === 'avis';
                        animated ||= brand === 'avis';
                    }
            }
            else if (type === 'meta' && parent === '') {
                if (payload + 4 > until)
                    return fail();
                visit(payload + 4, until, type, depth + 1);
            }
            else if (type === 'iprp' && parent === 'meta' || type === 'ipco' && parent === 'iprp')
                visit(payload, until, type, depth + 1);
            else if (type === 'ispe' && parent === 'ipco') {
                if (size !== header + 12)
                    return fail();
                const w = view.getUint32(payload + 4), h = view.getUint32(payload + 8);
                if (!w || !h || w > 12000 || h > 12000 || w * h > 24_000_000)
                    throw new ImageFormatError('dimensions');
                if (w * h > width * height) {
                    width = w;
                    height = h;
                }
            }
            at = until;
        }
    };
    visit(0, b.length);
    if (!branded || !width || !height)
        return fail();
    return { width, height, animated };
}
export function readImageInfo(b, declared = '') {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let mime, extension, width = 0, height = 0, rotation = 1, animated = false;
    if (b.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) && text(b, 12, 4) === 'IHDR') {
        mime = /* i18n-code: image MIME type */ 'image/png';
        extension = /* i18n-code: generated file name or extension */ 'png';
        width = view.getUint32(16);
        height = view.getUint32(20);
        for (let at = 8; at + 12 <= b.length;) {
            const size = view.getUint32(at), name = text(b, at + 4, 4);
            if (at + 12 + size > b.length)
                fail();
            if (name === 'acTL')
                animated = true;
            if (name === 'eXIf')
                rotation = orientation(b.subarray(at + 8, at + 8 + size));
            at += size + 12;
        }
    }
    else if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
        mime = /* i18n-code: image MIME type */ 'image/jpeg';
        extension = /* i18n-code: generated file name or extension */ 'jpg';
        for (let at = 2; at + 4 <= b.length;) {
            if (b[at++] !== 255)
                fail();
            while (b[at] === 255)
                at++;
            const marker = b[at++];
            if (marker === 217 || marker === 218)
                break;
            if (marker === 1 || marker >= 208 && marker <= 215)
                continue;
            if (at + 2 > b.length)
                fail();
            const size = view.getUint16(at);
            if (size < 2 || at + size > b.length)
                fail();
            if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 8) {
                height = view.getUint16(at + 3);
                width = view.getUint16(at + 5);
            }
            if (marker === 225 && text(b, at + 2, 6) === 'Exif\0\0')
                rotation = orientation(b.subarray(at + 2, at + size));
            at += size;
        }
    }
    else if (b.length >= 20 && text(b, 0, 4) === 'RIFF' && text(b, 8, 4) === 'WEBP') {
        mime = /* i18n-code: image MIME type */ 'image/webp';
        extension = /* i18n-code: generated file name or extension */ 'webp';
        if (view.getUint32(4, true) + 8 !== b.length)
            fail();
        for (let at = 12; at + 8 <= b.length;) {
            const name = text(b, at, 4), size = view.getUint32(at + 4, true), start = at + 8;
            if (start + size > b.length)
                fail();
            if (name === 'VP8X' && size >= 10) {
                width = 1 + b[start + 4] + (b[start + 5] << 8) + (b[start + 6] << 16);
                height = 1 + b[start + 7] + (b[start + 8] << 8) + (b[start + 9] << 16);
                animated ||= !!(b[start] & 2);
            }
            if (name === 'VP8 ' && size >= 10 && !width && b[start + 3] === 157 && b[start + 4] === 1 && b[start + 5] === 42) {
                width = view.getUint16(start + 6, true) & 16383;
                height = view.getUint16(start + 8, true) & 16383;
            }
            if (name === 'VP8L' && size >= 5 && !width && b[start] === 47) {
                const bits = view.getUint32(start + 1, true);
                width = (bits & 16383) + 1;
                height = ((bits >>> 14) & 16383) + 1;
            }
            if (name === 'ANIM' || name === 'ANMF')
                animated = true;
            if (name === 'EXIF')
                rotation = orientation(b.subarray(start, start + size));
            at = start + size + (size % 2);
        }
    }
    else if (b.length >= 13 && ['GIF87a', 'GIF89a'].includes(text(b, 0, 6))) {
        mime = /* i18n-code: image MIME type */ 'image/gif';
        extension = /* i18n-code: generated file name or extension */ 'gif';
        width = view.getUint16(6, true);
        height = view.getUint16(8, true);
        animated = true;
    }
    else if (b.length >= 54 && text(b, 0, 2) === 'BM' && view.getUint32(14, true) >= 40) {
        mime = /* i18n-code: image MIME type */ 'image/bmp';
        extension = /* i18n-code: generated file name or extension */ 'bmp';
        if (view.getUint32(2, true) !== b.length || view.getUint32(10, true) < 54 || view.getUint32(10, true) >= b.length)
            return fail();
        width = view.getInt32(18, true);
        height = Math.abs(view.getInt32(22, true));
    }
    else if (b.length >= 24 && text(b, 4, 4) === 'ftyp') {
        mime = /* i18n-code: image MIME type */ 'image/avif';
        extension = /* i18n-code: generated file name or extension */ 'avif';
        const info = avifDimensions(b);
        width = info.width;
        height = info.height;
        animated = info.animated;
    }
    else if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 1024)))) {
        // SVG is only a pass-through when a caller explicitly permits it. Upload
        // buckets continue to reject SVG; it is never rasterized or executed here.
        mime = /* i18n-code: image MIME type */ 'image/svg+xml';
        extension = /* i18n-code: generated file name or extension */ 'svg';
    }
    else
        return fail();
    if (declared && declared !== mime)
        fail();
    if (mime !== 'image/svg+xml' && (width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 24_000_000))
        throw new ImageFormatError(/* i18n-code: private image validation code */ 'dimensions');
    return { mime, extension, width, height, orientation: rotation, animated };
}
function crc32(b) {
    let crc = -1;
    for (const value of b) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
}
function pngExif(value) {
    const data = minimalExif(value), result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
    view.setUint32(0, data.length);
    result.set([101, 88, 73, 102], 4);
    result.set(data, 8);
    view.setUint32(result.length - 4, crc32(result.subarray(4, result.length - 4)));
    return result;
}
/** Lossless fallback: remove personal metadata; retain minimal orientation only. */
export function cleanImageMetadata(b, info) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength), parts = [];
    if (info.mime === 'image/jpeg') {
        parts.push(b.subarray(0, 2));
        if (info.orientation !== 1) {
            const exif = bytes(new Uint8Array([69, 120, 105, 102, 0, 0]), minimalExif(info.orientation));
            parts.push(bytes(new Uint8Array([255, 225, 0, exif.length + 2]), exif));
        }
        for (let at = 2; at < b.length;) {
            const start = at;
            if (b[at++] !== 255)
                return fail();
            while (b[at] === 255)
                at++;
            const marker = b[at++];
            if (marker === 217 || marker === 218) {
                parts.push(b.subarray(start));
                break;
            }
            if (marker === 1 || marker >= 208 && marker <= 215) {
                parts.push(b.subarray(start, at));
                continue;
            }
            if (at + 2 > b.length)
                return fail();
            const size = view.getUint16(at);
            if (size < 2 || at + size > b.length)
                return fail();
            if (marker !== 254 && !(marker >= 225 && marker <= 239 && marker !== 226 && marker !== 238))
                parts.push(b.subarray(start, at + size));
            at += size;
        }
    }
    else if (info.mime === 'image/png') {
        parts.push(b.subarray(0, 8));
        for (let at = 8; at + 12 <= b.length;) {
            const size = view.getUint32(at), name = text(b, at + 4, 4);
            if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(name))
                parts.push(b.subarray(at, at + size + 12));
            if (name === 'IHDR' && info.orientation !== 1)
                parts.push(pngExif(info.orientation));
            at += size + 12;
        }
    }
    else if (info.mime === 'image/webp') {
        for (let at = 12; at + 8 <= b.length;) {
            const size = view.getUint32(at + 4, true), name = text(b, at, 4), end = at + 8 + size + size % 2;
            if (name !== 'EXIF' && name !== 'XMP ') {
                const chunk = b.slice(at, end);
                if (name === 'VP8X')
                    chunk[8] &= ~12;
                parts.push(chunk);
            }
            at = end;
        }
        if (info.orientation !== 1) {
            const data = minimalExif(info.orientation), chunk = new Uint8Array(8 + data.length + data.length % 2);
            chunk.set([69, 88, 73, 70]);
            new DataView(chunk.buffer).setUint32(4, data.length, true);
            chunk.set(data, 8);
            parts.push(chunk);
            const extended = parts.find(p => text(p, 0, 4) === 'VP8X');
            if (extended)
                extended[8] |= 8;
        }
        const result = bytes(b.subarray(0, 12), ...parts);
        new DataView(result.buffer).setUint32(4, result.length - 8, true);
        return result;
    }
    else
        return b;
    return bytes(...parts);
}
