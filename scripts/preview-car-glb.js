'use strict';

const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { brotliCompressSync, constants } = require('node:zlib');
const express = require('express');
const demo = require('../config/car-3d');
const securityHeaders = require('../config/security-headers');
const registerDevCar3d = require('../controllers/dev-car-3d');
const { parseGlb } = require('./inspect-car-gltf');
const { inspectGltfImage } = require('./inspect-gltf-image');

const viewerFile = 'viewer.min.js';
const compressed = new Set([viewerFile, 'model.glb']);
const externalDecoders = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];

async function readAsset(file) {
  const info = await fs.stat(file);
  if (!info.isFile() || !info.size) throw new Error(`Choose a nonempty local file: ${file}`);
  return fs.readFile(file);
}

function checkEmbeddedModel(model) {
  const { gltf, bin } = parseGlb(model);
  const buffer = gltf?.buffers?.[0];
  if (gltf?.asset?.version !== '2.0' || gltf.buffers?.length !== 1 ||
      !bin?.length || buffer?.uri !== undefined ||
      !Number.isInteger(buffer?.byteLength) || buffer.byteLength < 1 || buffer.byteLength > bin.length ||
      gltf.images?.some(image => image.uri !== undefined)) {
    throw new Error('Export a self-contained GLB 2.0 with embedded geometry and images');
  }
  if (externalDecoders.some(extension => gltf.extensionsUsed?.includes(extension))) {
    throw new Error('Export GLB geometry without Draco or meshopt, and use embedded PNG or JPEG textures');
  }
}

function createPreviewApp(assetRoot, { name, creditLabel, posterFile, posterMime }) {
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
      creditLabel,
      homeHref: demo.labPath
    },
    assets: new Map([[viewerFile, 'text/javascript'], ['model.glb', 'model/gltf-binary'], [posterFile, posterMime]]),
    brotliAssets: compressed
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
  checkEmbeddedModel(model);
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
    for (const [file, bytes] of [[viewerFile, viewer], ['model.glb', model], [posterFile, poster]]) {
      if (stopped) return;
      await fs.writeFile(path.join(root, file), bytes, { mode: 0o600 });
      if (!stopped && compressed.has(file)) {
        const params = { [constants.BROTLI_PARAM_QUALITY]: 6 };
        await fs.writeFile(path.join(root, file + '.br'), brotliCompressSync(bytes, { params }), { mode: 0o600 });
      }
    }
    if (stopped) return;

    const app = createPreviewApp(root, { name, creditLabel, posterFile, posterMime: `image/${format}` });
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

module.exports = { createPreviewApp, checkEmbeddedModel };
