'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { measureScene } = require('./measure-gltf-scene');
const { inspectGltfImage } = require('./inspect-gltf-image');

function parseGlb(file) {
  if (file.length < 20 || file.toString('ascii', 0, 4) !== 'glTF' ||
      file.readUInt32LE(4) !== 2 || file.readUInt32LE(8) !== file.length) {
    throw new Error('Invalid GLB 2.0 header');
  }
  let gltf;
  let bin;
  for (let offset = 12; offset < file.length;) {
    if (offset + 8 > file.length) throw new Error('Incomplete GLB chunk header');
    const size = file.readUInt32LE(offset);
    const kind = file.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (size % 4 || end > file.length) throw new Error('Invalid GLB chunk length');
    const payload = file.subarray(offset + 8, end);
    if (offset === 12) {
      if (kind !== 0x4e4f534a) throw new Error('GLB must start with a JSON chunk');
      gltf = JSON.parse(payload.toString('utf8'));
    } else if (kind === 0x004e4942 && !bin) {
      if (offset !== 20 + file.readUInt32LE(12)) throw new Error('GLB binary chunk must follow JSON');
      bin = payload;
    } else if (kind === 0x4e4f534a || kind === 0x004e4942) {
      throw new Error('Duplicate GLB chunk');
    }
    offset = end;
  }
  return { gltf, bin };
}

function isBundlePath(relative) {
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function inspectCarGltf(input) {
  const filename = await fs.realpath(input);
  const root = path.dirname(filename);
  const extension = path.extname(filename).toLowerCase();
  if (!['.gltf', '.glb'].includes(extension) || !(await fs.stat(filename)).isFile()) {
    throw new Error('Choose a local .gltf or .glb model file');
  }
  const file = await fs.readFile(filename);
  const { gltf, bin } = extension === '.glb' ? parseGlb(file) : { gltf: JSON.parse(file.toString('utf8')) };
  if (gltf?.asset?.version !== '2.0') throw new Error('Expected a glTF 2.0 asset');
  if (bin && (!gltf.buffers?.[0] || gltf.buffers[0].uri !== undefined)) {
    throw new Error('GLB binary chunk must supply the first buffer');
  }

  const files = new Map([[filename, file]]);
  async function readResource(uri) {
    if (typeof uri !== 'string' || /^[a-z][a-z\d+.-]*:/i.test(uri) || /[?#\\]/.test(uri)) {
      throw new Error('Model resources must be relative files inside the model folder');
    }
    const relative = decodeURIComponent(uri);
    if (!isBundlePath(relative) || /[:\\\u0000]/.test(relative) || relative.split('/').includes('..')) {
      throw new Error('Model resources must be relative files inside the model folder');
    }
    const resolved = path.resolve(root, relative);
    if (!(await fs.lstat(resolved)).isFile()) throw new Error(`Model resource must be a regular file: ${uri}`);
    const real = await fs.realpath(resolved);
    if (!isBundlePath(path.relative(root, real))) throw new Error(`Model resource is outside the model folder: ${uri}`);
    if (!files.has(real)) files.set(real, await fs.readFile(real));
    return files.get(real);
  }

  const buffers = [];
  for (const [index, buffer] of (gltf.buffers || []).entries()) {
    const embedded = index === 0 && buffer.uri === undefined && bin;
    const bytes = embedded || await readResource(buffer.uri);
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 1 ||
        bytes.length < buffer.byteLength || (embedded && bytes.length > buffer.byteLength + 3)) {
      throw new Error(`Buffer ${index} length does not match the manifest`);
    }
    if (embedded && bytes.subarray(buffer.byteLength).some(byte => byte !== 0)) throw new Error('Invalid GLB binary padding');
    buffers.push(bytes.subarray(0, buffer.byteLength));
  }

  const geometry = measureScene(gltf, buffers);
  const images = [];
  for (const [index, item] of (gltf.images || []).entries()) {
    let bytes;
    if (item.uri !== undefined && item.bufferView === undefined) {
      bytes = await readResource(item.uri);
    } else if (item.uri === undefined && Number.isInteger(item.bufferView)) {
      if (!item.mimeType) throw new Error(`Image ${index} must declare a MIME type for its buffer view`);
      const view = gltf.bufferViews?.[item.bufferView];
      const buffer = view && buffers[view.buffer];
      const start = view?.byteOffset ?? 0;
      const size = view?.byteLength;
      if (!buffer || !Number.isInteger(start) || start < 0 || !Number.isInteger(size) || size < 1 ||
          start + size > buffer.length) throw new Error(`Invalid buffer view for image ${index}`);
      bytes = buffer.subarray(start, start + size);
    } else {
      throw new Error(`Image ${index} must have a file URI or a buffer view`);
    }
    try {
      const info = inspectGltfImage(bytes);
      if (item.mimeType && item.mimeType !== `image/${info.format}`) throw new Error('MIME type differs from the file header');
      images.push({ source: item.uri ?? `bufferView ${item.bufferView}`, ...info });
    } catch (err) {
      throw new Error(`Image ${index}: ${err.message}`);
    }
  }

  return {
    model: path.basename(filename),
    geometryMetres: geometry,
    images,
    assetFiles: Array.from(files, ([name, bytes]) => ({ name: path.relative(root, name), bytes: bytes.length })),
    assetBytes: Array.from(files.values()).reduce((total, bytes) => total + bytes.length, 0)
  };
}

if (require.main === module) {
  if (!process.argv[2] || process.argv.length !== 3) {
    console.error('Usage: node scripts/inspect-car-gltf.js <model.gltf or model.glb>');
    process.exitCode = 1;
  } else {
    inspectCarGltf(process.argv[2]).then(report => console.log(JSON.stringify(report, null, 2))).catch(err => {
      console.error(`Could not inspect model: ${err.message}`);
      process.exitCode = 1;
    });
  }
}

module.exports = { inspectCarGltf, parseGlb };
