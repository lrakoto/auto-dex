const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const Negotiator = require('negotiator');
const demo = require('../config/car-3d');

const compressedSuffixes = { br: '.br', gzip: '.gz' };
const preferred = Object.keys(compressedSuffixes);

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
  assetRoot = demo.assetRoot,
  scene = demo.scene,
  assets = demo.assets,
  compressedAssets = demo.compressedAssets
} = {}) {
  if (!demo.isEnabled(env)) return;

  const root = path.resolve(assetRoot);
  const modelUrl = demo.labPath + '/assets/' + encodeURIComponent(scene.modelFile);
  const posterUrl = demo.labPath + '/assets/' + encodeURIComponent(scene.posterFile);
  const router = express.Router({ caseSensitive: true });
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  });

  router.get('/', async (req, res) => {
    const policy = res.get('Content-Security-Policy');
    if (!req.secure && typeof policy === 'string') {
      // WebKit otherwise upgrades HTTP lab subresources before the poster can load.
      res.set('Content-Security-Policy', policy.split(';')
        .filter(directive => directive.trim() !== 'upgrade-insecure-requests').join(';'));
    }
    const present = await Promise.all(Array.from(assets.keys(), name => hasAsset(root, name)));
    res.render('dev-car-3d', { layout: false, assetsReady: present.every(Boolean), scene, modelUrl, posterUrl });
  });

  router.get('/assets/:name', async (req, res, next) => {
    const { name } = req.params;
    if (!assets.has(name) || !(await hasAsset(root, name))) return res.sendStatus(404);

    let file = name;
    const options = { root, dotfiles: 'deny', cacheControl: false };
    if (compressedAssets.has(name)) {
      res.vary('Accept-Encoding');
      const existing = await Promise.all(preferred.map(encoding => hasAsset(root, name + compressedSuffixes[encoding])));
      const available = preferred.filter((_encoding, index) => existing[index]);
      const encoding = new Negotiator(req).encoding([...available, 'identity'], { preferred });
      if (!encoding) return res.sendStatus(406);
      if (encoding !== 'identity') {
        file += compressedSuffixes[encoding];
        options.headers = { 'Content-Encoding': encoding };
        // Only the original file supports byte-range delivery.
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
