const path = require('node:path');

const labPath = '/dev/3d';
// Later releases eagerly initialize a WebAssembly decoder the lab does not use.
const viewer = {
  packageUrl: 'https://registry.npmjs.org/@google/model-viewer/-/model-viewer-4.0.0.tgz',
  packageSha512: 'hf4mixP178gGtvWQq97a0uULr7k98BwJGRU3lvt12XnurOdLmZA/RPdW4tPsINNNQxZvmvQsjud4lZWre6WGNw==',
  scriptSha256: '774edda21e1be2a0934e460ca5943af1fe3f88da130a9f98bd6a9d611576cacf'
};
const scene = {
  intro: 'Explore a sample model from different angles. This toy car is a demonstration asset.',
  category: 'Sample model',
  name: 'Khronos Toy Car',
  modelFile: 'ToyCar.gltf',
  modelAlt: 'Interactive 3D model of the Khronos Toy Car',
  posterFile: 'poster.jpg',
  posterAlt: 'Studio render of the Khronos toy car from the front and side',
  creditUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/ToyCar',
  creditLabel: 'Toy Car by Guido Odendahl and Eric Chadwick',
  creditNote: 'CC0 1.0. Poster from the original scene; the interactive model omits the fabric backdrop.',
  homeHref: '/'
};
const sample = {
  revision: 'car-only-v1',
  catalog: { make: 'AutoDex Lab', model: scene.name, type: 'car' }
};

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
  viewer,
  isEnabled,
  catalogPreviewFor,
  scene,
  assets,
  compressedAssets: new Set(['viewer.min.js', 'ToyCar.gltf', 'ToyCar.bin'])
};
