const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

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
  assetRoot = path.join(__dirname, '..', 'dev-assets', 'car-3d', 'car-only-v1')
} = {}) {
  if (env.ENABLE_3D_DEMO !== '1' || !['development', 'test'].includes(env.NODE_ENV)) return;

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
    res.type(assets.get(name));
    res.sendFile(name, { root, dotfiles: 'deny', cacheControl: false }, err => {
      if (!err) return;
      if (!res.headersSent && err.status === 404) return res.sendStatus(404);
      next(err);
    });
  });

  router.use((req, res) => res.sendStatus(404));
  // Express's string mounts best match /dev/3d and descendants, including
  // a trailing slash, without capturing another route's prefix.
  app.use('/dev/3d', router);
};
