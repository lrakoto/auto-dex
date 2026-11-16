'use strict';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngDepths = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]]
]);
const jpegFrames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function pngSize(buffer) {
  // Eight signature bytes, eight chunk header bytes, thirteen data bytes and a CRC.
  if (buffer.length < 33 || buffer.readUInt32BE(8) !== 13 || buffer.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('Malformed PNG image: missing or incomplete IHDR chunk');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) {
    throw new Error('Malformed PNG image: invalid width or height in IHDR');
  }
  const [depth, color, compression, filter, interlace] = buffer.subarray(24, 29);
  if (!pngDepths.get(color)?.includes(depth) || compression !== 0 || filter !== 0 || interlace > 1) {
    throw new Error('Malformed PNG image: invalid IHDR format fields');
  }
  return { width, height };
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('Malformed JPEG image: missing segment marker');
    // A marker can be preceded by any number of 0xff fill bytes.
    do { offset++; } while (buffer[offset] === 0xff);
    const marker = buffer[offset++];
    if (marker === 0xda || marker === 0xd9) break; // start of scan or end of image
    if (marker === 0x01) continue; // TEM is a standalone marker
    if (marker < 0xc0 || (marker >= 0xd0 && marker <= 0xd8) || offset + 2 > buffer.length) {
      throw new Error('Malformed JPEG image: invalid or incomplete segment marker');
    }
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) {
      throw new Error('Malformed JPEG image: invalid or truncated segment length');
    }
    if (jpegFrames.has(marker)) {
      if (length < 8 || !buffer[offset + 7] || length !== 8 + 3 * buffer[offset + 7]) {
        throw new Error('Malformed JPEG image: incomplete start-of-frame header');
      }
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (!width || !height) throw new Error('Malformed or unsupported JPEG image: frame width or height is zero');
      return { width, height };
    }
    offset += length;
  }
  throw new Error('Malformed JPEG image: no readable start-of-frame header');
}

// Inspect the size headers without decoding pixels or validating image data.
function inspectGltfImage(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Image inspection requires a Buffer');
  if (buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return { format: 'png', ...pngSize(buffer), bytes: buffer.length };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { format: 'jpeg', ...jpegSize(buffer), bytes: buffer.length };
  }
  throw new Error('Unsupported image format: expected PNG or JPEG');
}

function embeddedImageBytes(gltf, buffers, index) {
  const { bufferView } = gltf.images[index];
  const view = Number.isInteger(bufferView) && gltf.bufferViews?.[bufferView];
  const buffer = view && buffers[view.buffer];
  const start = view?.byteOffset ?? 0;
  const size = view?.byteLength;
  if (!buffer || !Number.isInteger(start) || start < 0 || !Number.isInteger(size) || size < 1 ||
      start + size > buffer.length) throw new Error(`Invalid buffer view for image ${index}`);
  return buffer.subarray(start, start + size);
}

module.exports = { embeddedImageBytes, inspectGltfImage };
