const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const request = require('supertest');
const registerDevCar3d = require('../controllers/dev-car-3d');

const manifest = [
  'viewer.min.js', 'ToyCar.gltf', 'ToyCar.bin', 'ToyCar_normal.png',
  'ToyCar_emissive.png', 'ToyCar_basecolor.png', 'ToyCar_occlusion_roughness_metallic.png',
  'ToyCar_clearcoat.png', 'poster.jpg'
];

describe('Local 3D viewer lab', function () {
  let assets;
  const enabled = { NODE_ENV: 'development', ENABLE_3D_DEMO: '1' };

  function lab(env) {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../views'));
    // Match the app mounting order without importing its DB and session store.
    app.use(helmet({ contentSecurityPolicy: { directives: {
      connectSrc: ["'self'"]
    } } }));
    registerDevCar3d(app, { env, assetRoot: assets });
    return request(app);
  }

  beforeEach(async function () {
    assets = await fs.mkdtemp(path.join(os.tmpdir(), 'autodex-3d-test-'));
  });
  afterEach(async function () {
    await fs.rm(assets, { recursive: true, force: true });
  });

  it('exposes neither the page nor its assets without explicit non-production opt-in', async function () {
    await fs.writeFile(path.join(assets, 'ToyCar.gltf'), '{}');
    for (const env of [
      { NODE_ENV: 'development' },
      { NODE_ENV: 'development', ENABLE_3D_DEMO: 'true' },
      { NODE_ENV: 'test' },
      { ENABLE_3D_DEMO: '1' },
      { NODE_ENV: 'production', ENABLE_3D_DEMO: '1' }
    ]) {
      const app = lab(env);
      await app.get('/dev/3d').expect(404);
      await app.get('/dev/3d/assets/ToyCar.gltf').expect(404);
    }
  });

  it('renders a setup message on both route spellings when even one required asset is missing', async function () {
    await Promise.all(manifest.filter(name => name !== 'ToyCar.bin')
      .map(name => fs.writeFile(path.join(assets, name), 'fixture')));
    for (const url of ['/dev/3d', '/dev/3d/']) {
      const res = await lab({ ...enabled, NODE_ENV: 'test' }).get(url)
        .expect('Cache-Control', 'no-store')
        .expect('X-Robots-Tag', 'noindex')
        .expect(200);
      assert.match(res.text, /id="car-3d-missing"/);
      assert.doesNotMatch(res.text, /id="car-3d-load"/);
    }
  });

  it('renders the standalone poster view with the existing same-origin connect policy', async function () {
    await Promise.all(manifest.map(name => fs.writeFile(path.join(assets, name), 'fixture')));
    const res = await lab(enabled).get('/dev/3d').expect(200);
    assert.match(res.text, /<title>3D Viewer Lab \| AutoDex<\/title>/);
    assert.match(res.text, /id="car-3d-load"/);
    assert.match(res.text, /src="\/dev\/3d\/assets\/poster\.jpg"/);
    assert.doesNotMatch(res.text, /id="car-3d-missing"/);
    assert.doesNotMatch(res.text, /<(?:script|link|model-viewer)\b[^>]*(?:src|href)\s*=\s*["'][^"']*(?:viewer\.min\.js|ToyCar\.(?:gltf|bin))/i);
    assert.match(res.headers['content-security-policy'], /(?:^|;)connect-src 'self'(?:;|$)/);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  it('serves only listed regular files with explicit types and no reusable cache', async function () {
    await fs.writeFile(path.join(assets, 'ToyCar.gltf'), '{"asset":{"version":"2.0"}}');
    await fs.writeFile(path.join(assets, 'private.txt'), 'not public');
    await fs.writeFile(path.join(assets, '.not-public'), 'not public');
    await fs.writeFile(path.join(assets, 'Fabric_normal.png'), 'old backdrop texture');
    await fs.symlink('private.txt', path.join(assets, 'ToyCar.bin'));
    const app = lab(enabled);
    await app.get('/dev/3d/assets/ToyCar.gltf')
      .expect('Content-Type', /^model\/gltf\+json\b/)
      .expect('Cache-Control', 'no-store')
      .expect(200);
    for (const name of ['private.txt', '.not-public', 'Fabric_normal.png', 'ToyCar.bin', 'toycar.gltf', 'missing.png']) {
      await app.get('/dev/3d/assets/' + name).expect(404);
    }
    await app.get('/dev/3d/assets/').expect(404);
    await app.get('/dev/3d/assets/..%2Fprivate.txt').expect(404);
  });
});
