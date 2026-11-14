const path = require('node:path');

const labPath = '/dev/3d';
const sample = {
  revision: 'car-only-v1',
  catalog: { make: 'AutoDex Lab', model: 'Khronos Toy Car', type: 'car' }
};

function isEnabled(env = process.env) {
  return env.ENABLE_3D_DEMO === '1' && ['development', 'test'].includes(env.NODE_ENV);
}

function catalogPreviewFor(car) {
  const { make, model, type } = sample.catalog;
  if (!isEnabled() || !car || car.make !== make || car.model !== model || car.vehicle_type !== type) return null;
  return { href: labPath, label: 'Try the 3D viewer' };
}

module.exports = {
  assetRoot: path.join(__dirname, '..', 'dev-assets', 'car-3d', sample.revision),
  labPath,
  isEnabled,
  catalogPreviewFor,
  brotliAssets: new Set(['viewer.min.js', 'ToyCar.gltf', 'ToyCar.bin'])
};
