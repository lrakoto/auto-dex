'use strict';

// Fetch the reproducible, local-only sample. No npm packages are installed.
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { brotliCompressSync, constants } = require('node:zlib');
const { assetRoot, brotliAssets } = require('../config/car-3d');
const trimToyCar = require('./trim-toy-car');

const revision = '8f492390ddc7a2ae221a1369ef560589cf8c70fb';
const sample = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${revision}/Models/ToyCar/`;
// Later releases eagerly initialize a WebAssembly decoder this sample never uses.
const viewer = 'https://registry.npmjs.org/@google/model-viewer/-/model-viewer-4.0.0.tgz';
const viewerSha512 = 'hf4mixP178gGtvWQq97a0uULr7k98BwJGRU3lvt12XnurOdLmZA/RPdW4tPsINNNQxZvmvQsjud4lZWre6WGNw==';
const sampleFiles = ['ToyCar.gltf', 'ToyCar.bin', 'ToyCar_normal.png', 'ToyCar_emissive.png',
  'ToyCar_basecolor.png', 'ToyCar_occlusion_roughness_metallic.png', 'ToyCar_clearcoat.png'];

async function fetchBytes(url) {
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function installAssets(files) {
  await fs.mkdir(assetRoot, { recursive: true });
  const pending = await fs.mkdtemp(path.join(assetRoot, '.setup-'));
  try {
    await Promise.all(Array.from(files, ([name, content]) => fs.writeFile(path.join(pending, name), content)));
    // Rename each completed file into place on the same filesystem. The
    // original manifest is last so an incomplete setup won't appear ready.
    for (const name of files.keys()) {
      if (name !== 'ToyCar.gltf') await fs.rename(path.join(pending, name), path.join(assetRoot, name));
    }
    await fs.rename(path.join(pending, 'ToyCar.gltf'), path.join(assetRoot, 'ToyCar.gltf'));
  } finally {
    await fs.rm(pending, { recursive: true, force: true });
  }
}

async function main() {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'autodex-3d-'));
  try {
    const bytes = await fetchBytes(viewer);
    if (createHash('sha512').update(bytes).digest('base64') !== viewerSha512) {
      throw new Error('Pinned model-viewer package failed its integrity check');
    }
    const archive = path.join(staging, 'viewer.tgz');
    await fs.writeFile(archive, bytes);

    const files = new Map([
      ['viewer.min.js', execFileSync('tar', ['-xOf', archive, 'package/dist/model-viewer.min.js'], { maxBuffer: 2 * 1024 * 1024 })],
      ['VIEWER-LICENSE.txt', execFileSync('tar', ['-xOf', archive, 'package/LICENSE'])]
    ]);
    await Promise.all([
      ...sampleFiles.map(async name => files.set(name, await fetchBytes(`${sample}glTF/${name}`))),
      fetchBytes(`${sample}screenshot/screenshot.jpg`).then(poster => files.set('poster.jpg', poster)),
      fetchBytes(`${sample}LICENSE.md`).then(license => files.set('TOY-CAR-LICENSE.md', license))
    ]);
    const { gltf, geometry } = trimToyCar(JSON.parse(files.get('ToyCar.gltf')), files.get('ToyCar.bin'));
    files.set('ToyCar.gltf', JSON.stringify(gltf));
    files.set('ToyCar.bin', geometry);
    const brotliOptions = { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } };
    for (const name of brotliAssets) {
      files.set(`${name}.br`, brotliCompressSync(files.get(name), brotliOptions));
    }
    const modelBytes = sampleFiles.reduce((sum, name) => sum + Buffer.byteLength(files.get(name)), 0);
    await installAssets(files);
    console.log(`Local 3D sample ready (${(modelBytes / 1_000_000).toFixed(2)} MB for the model).`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
