const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const demo = require('../config/car-3d');

const assets = new Map([
  ['viewer.min.js', 'text/javascript'],
  ['ToyCar.gltf', 'model/gltf+json'],
  ['ToyCar.bin', 'application/octet-stream'],
  ['ToyCar_normal.png', 'image/png'],
  ['ToyCar_emissive.png', 'image/png'],
  ['ToyCar_basecolor.png', 'image/png'],
  ['ToyCar_occlusion_roughness_metallic.png', 'image/png'],
  ['ToyCar_clearcoat.png', 'image/png'],
  ['poster.jpg', 'image/jpeg']
]);

async function hasAsset(root, name) {
  try {
    const info = await fs.lstat(path.join(root, name));
    // Don't serve symlinks or an incomplete (empty) download.
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

module.exports = function registerDevCar3d(app, {
  env = process.env,
  assetRoot = demo.assetRoot
} = {}) {
  if (!demo.isEnabled(env)) return;

  const root = path.resolve(assetRoot);
  const router = express.Router({ caseSensitive: true });
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  });

  router.get('/', async (req, res) => {
    const present = await Promise.all(Array.from(assets.keys(), name => hasAsset(root, name)));
    res.render('dev-car-3d', { layout: false, assetsReady: present.every(Boolean) });
  });

  router.get('/assets/:name', async (req, res, next) => {
    const { name } = req.params;
    if (!assets.has(name) || !(await hasAsset(root, name))) return res.sendStatus(404);

    let file = name;
    const options = { root, dotfiles: 'deny', cacheControl: false };
    if (demo.brotliAssets.has(name)) {
      res.vary('Accept-Encoding');
      const sidecar = `${name}.br`;
      const available = await hasAsset(root, sidecar) ? ['br', 'identity'] : ['identity'];
      const encoding = req.acceptsEncodings(available);
      if (!encoding) return res.sendStatus(406);
      if (encoding === 'br') {
        file = sidecar;
        options.headers = { 'Content-Encoding': 'br' };
        // A partial Brotli stream cannot be decoded as the original file.
        options.acceptRanges = false;
      }
    }

    res.type(assets.get(name));
    res.sendFile(file, options, err => {
      if (!err) return;
      if (!res.headersSent) {
        // Error responses do not carry the file's content encoding.
        res.removeHeader('Content-Encoding');
        if (err.status === 404 || err.status === 412) return res.sendStatus(err.status);
      }
      next(err);
    });
  });

  router.use((req, res) => res.sendStatus(404));
  // Express's string mounts best match /dev/3d and descendants, including
  // a trailing slash, without capturing another route's prefix.
  app.use(demo.labPath, router);
};
