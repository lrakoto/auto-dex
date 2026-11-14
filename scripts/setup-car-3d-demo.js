'use strict';

// Fetch the reproducible, local-only sample. No npm packages are installed.
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const revision = '8f492390ddc7a2ae221a1369ef560589cf8c70fb';
const sample = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${revision}/Models/ToyCar/`;
// Later releases eagerly initialize a WebAssembly decoder this sample never uses.
const viewer = 'https://registry.npmjs.org/@google/model-viewer/-/model-viewer-4.0.0.tgz';
const viewerSha512 = 'hf4mixP178gGtvWQq97a0uULr7k98BwJGRU3lvt12XnurOdLmZA/RPdW4tPsINNNQxZvmvQsjud4lZWre6WGNw==';
const sampleFiles = ['ToyCar.gltf', 'ToyCar.bin', 'ToyCar_normal.png', 'ToyCar_emissive.png',
  'ToyCar_basecolor.png', 'ToyCar_occlusion_roughness_metallic.png', 'Fabric_normal.png',
  'Fabric_occlusion.png', 'Fabric_baseColor.png', 'ToyCar_clearcoat.png'];

async function fetchBytes(url) {
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const dir = path.join(__dirname, '..', 'dev-assets', 'car-3d');
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
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([...files].map(([name, content]) => fs.writeFile(path.join(dir, name), content)));
    const servedBytes = [...files].filter(([name]) => !name.includes('LICENSE')).reduce((sum, [, content]) => sum + content.length, 0);
    console.log(`Local 3D sample ready (${(servedBytes / 1024 / 1024).toFixed(2)} MiB including the viewer and poster).`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
