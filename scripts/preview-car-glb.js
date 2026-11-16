'use strict';

const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { brotliCompressSync, constants, gzipSync } = require('node:zlib');
const express = require('express');
const demo = require('../config/car-3d');
const securityHeaders = require('../config/security-headers');
const registerDevCar3d = require('../controllers/dev-car-3d');
const { parseGlb } = require('./inspect-car-gltf');
const { embeddedImageBytes, inspectGltfImage } = require('./inspect-gltf-image');

const viewerFile = 'viewer.min.js';
const compressedAssets = new Set([viewerFile, 'model.glb']);
const externalDecoders = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];
// These extensions only add material settings or references to textures.
const materialExtensions = new Set([
  'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_unlit', 'KHR_texture_transform'
]);

async function readAsset(file) {
  const info = await fs.stat(file);
  if (!info.isFile() || !info.size) throw new Error(`Choose a nonempty local file: ${file}`);
  return fs.readFile(file);
}

function checkEmbeddedModel(model) {
  const { gltf, bin } = parseGlb(model);
  const buffer = gltf?.buffers?.[0];
  const images = gltf?.images ?? [];
  if (gltf?.asset?.version !== '2.0' || gltf.buffers?.length !== 1 ||
      !bin?.length || buffer?.uri !== undefined ||
      !Number.isInteger(buffer?.byteLength) || buffer.byteLength < 1 || buffer.byteLength > bin.length ||
      !Array.isArray(images) || images.some(image => !image || image.uri !== undefined)) {
    throw new Error('Export a self-contained GLB 2.0 with embedded geometry and images');
  }
  if (externalDecoders.some(extension => gltf.extensionsUsed?.includes(extension))) {
    throw new Error('Export GLB geometry without Draco or meshopt, and use embedded PNG or JPEG textures');
  }
  return { gltf, bin, images };
}

function isAlignmentPadding(bytes, start, end) {
  return end >= start && end - start <= 3 && bytes.subarray(start, end).every(byte => byte === 0);
}

function trimTextureChunk(gltf, bin, chunks, imageViews) {
  // Additional chunks or unfamiliar extensions may reference the original BIN.
  if (chunks.length !== bin.length + 8) return chunks;
  for (const declared of [gltf.extensionsUsed, gltf.extensionsRequired]) {
    if (declared !== undefined && (!Array.isArray(declared) || declared.some(name => !materialExtensions.has(name)))) return chunks;
  }

  const views = gltf.bufferViews;
  if (!Array.isArray(views)) return chunks;
  const retain = views.length - imageViews.size;
  if (retain < 1 || views.some((_view, index) => imageViews.has(index) !== (index >= retain))) return chunks;

  // Keep both the index and byte offset of every remaining buffer view.
  const accessors = gltf.accessors ?? [];
  if (!Array.isArray(accessors) || accessors.some(accessor => [
    accessor?.bufferView, accessor?.sparse?.indices?.bufferView, accessor?.sparse?.values?.bufferView
  ].some(index => index !== undefined && (!Number.isInteger(index) || index < 0 || index >= retain)))) return chunks;

  let geometryEnd = 0;
  for (const view of views.slice(0, retain)) {
    const start = view?.byteOffset ?? 0;
    const length = view?.byteLength;
    if (view?.buffer !== 0 || !Number.isInteger(start) || start < 0 ||
        !Number.isInteger(length) || length < 1 || start + length > gltf.buffers[0].byteLength) return chunks;
    geometryEnd = Math.max(geometryEnd, start + length);
  }

  // The discarded suffix must consist entirely of images and alignment bytes.
  const suffix = views.slice(retain).sort((a, b) => (a.byteOffset ?? 0) - (b.byteOffset ?? 0));
  let end = geometryEnd;
  for (const view of suffix) {
    const start = view.byteOffset ?? 0;
    if (view.buffer !== 0 || !isAlignmentPadding(bin, end, start)) return chunks;
    end = start + view.byteLength;
  }
  if (!isAlignmentPadding(bin, end, bin.length)) return chunks;

  const paddedLength = Math.ceil(geometryEnd / 4) * 4;
  const trimmed = Buffer.alloc(8 + paddedLength);
  chunks.copy(trimmed, 0, 0, 8 + geometryEnd);
  trimmed.writeUInt32LE(paddedLength);
  views.length = retain;
  gltf.buffers[0].byteLength = geometryEnd;
  return trimmed;
}

function preparePreviewModel(model) {
  const { gltf, bin, images } = checkEmbeddedModel(model);
  if (!images.length) return { model, textures: [] };

  const buffers = [bin.subarray(0, gltf.buffers[0].byteLength)];
  const imageViews = new Set(images.map(image => image.bufferView));
  const textures = images.map((image, index) => {
    const bytes = embeddedImageBytes(gltf, buffers, index);
    const { format } = inspectGltfImage(bytes);
    if (image.mimeType !== `image/${format}`) throw new Error(`Image ${index}: MIME type differs from the file header`);
    const name = `texture-${index}.${format === 'jpeg' ? 'jpg' : format}`;
    image.uri = name;
    delete image.bufferView;
    return { name, mimeType: image.mimeType, bytes };
  });

  const originalChunks = model.subarray(20 + model.readUInt32LE(12));
  const remainingChunks = trimTextureChunk(gltf, bin, originalChunks, imageViews);
  const json = Buffer.from(JSON.stringify(gltf));
  const paddedSize = Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(20 + paddedSize, 0x20);
  model.copy(prefix, 0, 0, 20);
  prefix.writeUInt32LE(prefix.length + remainingChunks.length, 8);
  prefix.writeUInt32LE(paddedSize, 12);
  json.copy(prefix, 20);
  return { model: Buffer.concat([prefix, remainingChunks]), textures };
}

function createPreviewApp(assetRoot, { name, creditLabel, posterFile, posterMime, textureAssets = [] }) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(securityHeaders);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    if (req.get('Host') !== `127.0.0.1:${req.socket.localPort}`) return res.sendStatus(403);
    next();
  });
  for (const file of ['js/car-3d-demo.js', 'css/car-3d-demo.css']) {
    app.get('/' + file, (_req, res) => {
      res.sendFile(path.join(__dirname, '../public', file), { cacheControl: false });
    });
  }
  app.get('/', (_req, res) => res.redirect(demo.labPath));
  registerDevCar3d(app, {
    env: { NODE_ENV: 'development', ENABLE_3D_DEMO: '1' },
    assetRoot,
    scene: {
      intro: 'Inspect the model and test the viewer controls.',
      category: 'Private preview',
      name,
      modelFile: 'model.glb',
      modelAlt: `Interactive 3D model of ${name}`,
      posterFile,
      posterAlt: `Preview image of ${name}`,
      missingAssetHelp: 'Restart the private preview with the local model and poster files.',
      creditLabel,
      homeHref: demo.labPath
    },
    assets: new Map([[viewerFile, 'text/javascript'], ['model.glb', 'model/gltf-binary'], [posterFile, posterMime], ...textureAssets]),
    compressedAssets
  });
  return app;
}

async function run(args) {
  if (process.env.NODE_ENV === 'production') throw new Error('The preview command is for local development');
  const [modelPath, posterPath, name, creditLabel] = args;
  if (args.length !== 4 || !name.trim() || !creditLabel.trim()) {
    throw new Error('Usage: node scripts/preview-car-glb.js <model.glb> <poster.png-or-jpg> "<model name>" "<asset credit>"');
  }
  const [model, poster, viewer] = await Promise.all([
    readAsset(modelPath),
    readAsset(posterPath),
    readAsset(path.join(demo.assetRoot, viewerFile)).catch(() => {
      throw new Error('Install the pinned viewer with node scripts/setup-car-3d-demo.js');
    })
  ]);
  const prepared = preparePreviewModel(model);
  const { format } = inspectGltfImage(poster);
  const posterFile = format === 'jpeg' ? 'poster.jpg' : 'poster.png';
  if (createHash('sha256').update(viewer).digest('hex') !== demo.viewer.scriptSha256) {
    throw new Error('Viewer bytes differ from the pinned version. Rerun node scripts/setup-car-3d-demo.js');
  }

  let root;
  let stopped = false;
  let stopServer;
  const stop = () => {
    stopped = true;
    stopServer?.();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'autodex-glb-preview-'));
    const files = [[viewerFile, viewer], ['model.glb', prepared.model], [posterFile, poster],
      ...prepared.textures.map(({ name, bytes }) => [name, bytes])];
    for (const [file, bytes] of files) {
      if (stopped) return;
      await fs.writeFile(path.join(root, file), bytes, { mode: 0o600 });
      if (!stopped && compressedAssets.has(file)) {
        const params = { [constants.BROTLI_PARAM_QUALITY]: 6 };
        await fs.writeFile(path.join(root, file + '.br'), brotliCompressSync(bytes, { params }), { mode: 0o600 });
        if (!stopped) await fs.writeFile(path.join(root, file + '.gz'), gzipSync(bytes), { mode: 0o600 });
      }
    }
    if (stopped) return;

    const textureAssets = prepared.textures.map(({ name, mimeType }) => [name, mimeType]);
    const app = createPreviewApp(root, { name, creditLabel, posterFile, posterMime: `image/${format}`, textureAssets });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const closed = once(server, 'close');
    stopServer = () => server.close();
    if (stopped) stopServer();
    else console.log(`Private preview: http://127.0.0.1:${server.address().port}${demo.labPath}`);
    await closed;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createPreviewApp, checkEmbeddedModel, preparePreviewModel };
