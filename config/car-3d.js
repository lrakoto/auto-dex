const path = require('node:path');

module.exports = {
  assetRoot: path.join(__dirname, '..', 'dev-assets', 'car-3d', 'car-only-v1'),
  brotliAssets: new Set(['viewer.min.js', 'ToyCar.gltf', 'ToyCar.bin'])
};
