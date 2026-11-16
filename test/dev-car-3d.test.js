const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } = require('node:zlib');
const express = require('express');
const helmet = require('helmet');
const request = require('supertest');
const registerDevCar3d = require('../controllers/dev-car-3d');

const manifest = [
  'viewer.min.js', 'ToyCar.gltf', 'ToyCar.bin', 'ToyCar_normal.png',
  'ToyCar_emissive.png', 'ToyCar_basecolor.png', 'ToyCar_occlusion_roughness_metallic.png',
  'ToyCar_clearcoat.png', 'poster.jpg'
];
const encodings = [
  { name: 'br', extension: 'br', accept: 'gzip, deflate, br, zstd', compress: brotliCompressSync, decompress: brotliDecompressSync },
  { name: 'gzip', extension: 'gz', accept: 'gzip, deflate', compress: gzipSync, decompress: gunzipSync }
];

describe('Local 3D viewer lab', function () {
  let assets;
  const enabled = { NODE_ENV: 'development', ENABLE_3D_DEMO: '1' };

  function labApp(env, options = {}) {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../views'));
    // Match the app mounting order without importing its DB and session store.
    app.use(helmet({ contentSecurityPolicy: { directives: {
      connectSrc: ["'self'"]
    } } }));
    registerDevCar3d(app, { env, assetRoot: assets, ...options });
    return app;
  }

  const lab = (env) => request(labApp(env));

  async function withRawServer(app, run) {
    // Avoid clients that decompress responses before tests can inspect wire bytes.
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      await run((name, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1', port: server.address().port,
          path: '/dev/3d/assets/' + name, method, headers
        }, async (res) => {
          try {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
          } catch (err) {
            reject(err);
          }
        });
        req.on('error', reject);
        req.end();
      }));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  beforeEach(async function () {
    assets = await fs.mkdtemp(path.join(os.tmpdir(), 'autodex-3d-test-'));
  });
  afterEach(async function () {
    await fs.rm(assets, { recursive: true, force: true });
  });

  it('exposes neither the page nor its assets without explicit non-production opt-in', async function () {
    await fs.writeFile(path.join(assets, 'ToyCar.gltf'), '{}');
    await Promise.all(encodings.map(({ extension, compress }) =>
      fs.writeFile(path.join(assets, 'ToyCar.gltf.' + extension), compress('{}'))));
    for (const env of [
      { NODE_ENV: 'development' },
      { NODE_ENV: 'development', ENABLE_3D_DEMO: 'true' },
      { NODE_ENV: 'test' },
      { ENABLE_3D_DEMO: '1' },
      { NODE_ENV: 'production', ENABLE_3D_DEMO: '1' }
    ]) {
      const app = lab(env);
      await app.get('/dev/3d').expect(404);
      for (const { accept, extension } of encodings) {
        await app.get('/dev/3d/assets/ToyCar.gltf').set('Accept-Encoding', accept).expect(404);
        await app.get('/dev/3d/assets/ToyCar.gltf.' + extension).expect(404);
      }
    }
  });

  it('shows the poster and setup guidance on both route spellings when geometry is missing', async function () {
    await Promise.all(manifest.filter(name => name !== 'ToyCar.bin')
      .map(name => fs.writeFile(path.join(assets, name), 'fixture')));
    const app = lab({ ...enabled, NODE_ENV: 'test' });
    for (const url of ['/dev/3d', '/dev/3d/']) {
      const res = await app.get(url)
        .expect('Cache-Control', 'no-store')
        .expect('X-Robots-Tag', 'noindex')
        .expect(200);
      assert.match(res.text, /id="car-3d-missing"/);
      assert.match(res.text, /Run the local 3D demo setup/);
      assert.match(res.text, /<img\b[^>]*id="car-3d-poster"[^>]*src="\/dev\/3d\/assets\/poster\.jpg"[^>]*alt="Studio render of the Khronos toy car from the front and side"/);
      assert.doesNotMatch(res.text, /id="car-3d-(load|controls)"|car-3d-demo\.js|viewer\.min\.js|ToyCar\.(gltf|bin)/i);
    }
    await app.get('/dev/3d/assets/poster.jpg').expect('Content-Type', /^image\/jpeg\b/).expect(200);
  });

  it('omits the poster when it is missing, empty, or a symlink', async function () {
    const app = lab(enabled);
    async function expectMissingPoster() {
      const res = await app.get('/dev/3d').expect(200);
      assert.match(res.text, /3D preview files are unavailable\./);
      assert.doesNotMatch(res.text, /id="car-3d-(poster|load|controls)"|\/dev\/3d\/assets\/poster\.jpg|car-3d-demo\.js/);
    }

    await expectMissingPoster();
    const poster = path.join(assets, 'poster.jpg');
    await fs.writeFile(poster, '');
    await expectMissingPoster();
    await fs.unlink(poster);
    await fs.writeFile(path.join(assets, 'private.jpg'), 'fixture');
    await fs.symlink('private.jpg', poster);
    await expectMissingPoster();
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

  it('keeps HTTP asset URLs usable in WebKit only on the opted-in lab document', async function () {
    const web = labApp(enabled);
    web.set('trust proxy', 1);
    web.get('/unrelated', (_req, res) => res.sendStatus(200));
    const app = request(web);
    const header = 'content-security-policy';
    const baseline = (await app.get('/unrelated').expect(200)).headers[header];
    assert.match(baseline, /(?:^|;)upgrade-insecure-requests(?:;|$)/);
    const localPolicy = baseline.split(';').filter(directive => directive !== 'upgrade-insecure-requests').join(';');

    for (const url of ['/dev/3d', '/dev/3d/']) {
      await app.get(url).expect(200).expect(header, localPolicy);
    }
    await app.get('/dev/3d').set('X-Forwarded-Proto', 'https').expect(200).expect(header, baseline);
    await fs.writeFile(path.join(assets, 'poster.jpg'), 'poster');
    await app.get('/dev/3d/assets/poster.jpg').expect(200).expect(header, baseline);
    const production = labApp({ ...enabled, NODE_ENV: 'production' });
    production.use((_req, res) => res.sendStatus(404));
    await request(production).get('/dev/3d').expect(404).expect(header, baseline);
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

  it('negotiates Brotli and gzip for packed assets under their original URLs and types', async function () {
    const representations = [
      ['viewer.min.js', /javascript\b/, 'const viewer = true;\n'],
      ['ToyCar.gltf', /^model\/gltf\+json\b/, '{"asset":{"version":"2.0"}}'],
      ['ToyCar.bin', /^application\/octet-stream\b/, Buffer.from([0, 1, 2, 128, 255])]
    ].map(([name, type, body]) => [name, type, Buffer.from(body)]);
    await Promise.all(representations.flatMap(([name, , body]) => [
      fs.writeFile(path.join(assets, name), body),
      ...encodings.map(({ extension, compress }) =>
        fs.writeFile(path.join(assets, name + '.' + extension), compress(body)))
    ]));

    await withRawServer(labApp(enabled), async get => {
      for (const { name: encoding, extension, accept, decompress } of encodings) {
        const headers = { 'Accept-Encoding': accept };
        for (const [name, type, body] of representations) {
          const decodedSize = name === 'ToyCar.gltf' ? String(body.length) : undefined;
          const packed = await get(name, { headers });
          assert.equal(packed.status, 200);
          assert.match(packed.headers['content-type'], type);
          assert.equal(packed.headers['content-encoding'], encoding);
          assert.match(packed.headers.vary, /\bAccept-Encoding\b/i);
          assert.equal(packed.headers['cache-control'], 'no-store');
          assert.equal(packed.headers['x-robots-tag'], 'noindex');
          assert.equal(packed.headers['x-file-size'], decodedSize);
          assert.deepEqual(decompress(packed.body), body);
          const head = await get(name, { headers, method: 'HEAD' });
          assert.equal(head.status, 200);
          assert.match(head.headers['content-type'], type);
          assert.equal(head.headers['content-encoding'], encoding);
          assert.equal(head.headers['x-file-size'], decodedSize);
          assert.match(head.headers.vary, /\bAccept-Encoding\b/i);
          assert.equal(Number(head.headers['content-length']), packed.body.length);
          assert.equal(head.body.length, 0);
        }

        const bin = representations[2][2];
        const whole = await get('ToyCar.bin?retry=1', { headers: { ...headers, Range: 'bytes=1-2' } });
        assert.equal(whole.status, 200);
        assert.equal(whole.headers['content-encoding'], encoding);
        assert.equal(whole.headers['content-range'], undefined);
        assert.deepEqual(decompress(whole.body), bin);
        const mismatch = await get('ToyCar.gltf', { headers: { ...headers, 'If-Match': '"mismatch"' } });
        assert.equal(mismatch.status, 412);
        assert.equal(mismatch.headers['content-encoding'], undefined);
        assert.equal(mismatch.headers['x-file-size'], undefined);
        assert.equal(mismatch.body.toString(), 'Precondition Failed');
        assert.equal((await get('ToyCar.bin.' + extension)).status, 404);
      }
    });
  });

  it('reports the original size only on compressed private GLB responses', async function () {
    const name = 'model.glb';
    const body = Buffer.alloc(128, 0x67);
    const packed = brotliCompressSync(body);
    await fs.writeFile(path.join(assets, name), body);
    await fs.writeFile(path.join(assets, name + '.br'), packed);
    const privateApp = labApp(enabled, {
      scene: { modelFile: name, posterFile: 'poster.jpg' },
      assets: new Map([[name, 'model/gltf-binary']]),
      compressedAssets: new Set([name])
    });

    await withRawServer(privateApp, async get => {
      const compressed = await get(name, { headers: { 'Accept-Encoding': 'br', Range: 'bytes=1-2' } });
      assert.equal(compressed.status, 200);
      assert.equal(compressed.headers['content-encoding'], 'br');
      assert.equal(compressed.headers['content-range'], undefined);
      assert.equal(Number(compressed.headers['content-length']), packed.length);
      assert.equal(Number(compressed.headers['x-file-size']), body.length);
      assert.deepEqual(compressed.body, packed);

      const identity = await get(name, { headers: { 'Accept-Encoding': 'identity', Range: 'bytes=1-2' } });
      assert.equal(identity.status, 206);
      assert.equal(identity.headers['x-file-size'], undefined);
      assert.equal(identity.headers['content-range'], 'bytes 1-2/128');
      assert.deepEqual(identity.body, body.subarray(1, 3));
    });
  });

  it('keeps originals usable when packed versions are unavailable or declined', async function () {
    const body = Buffer.from([0, 1, 2, 128, 255]);
    await fs.writeFile(path.join(assets, 'ToyCar.bin'), body);
    await withRawServer(labApp(enabled), async get => {
      async function checkIdentity(headers) {
        const res = await get('ToyCar.bin', { headers });
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-encoding'], undefined);
        assert.match(res.headers.vary, /\bAccept-Encoding\b/i);
        assert.deepEqual(res.body, body);
      }
      for (const { name, extension, compress } of encodings) {
        const sidecar = path.join(assets, 'ToyCar.bin.' + extension);
        const headers = { 'Accept-Encoding': name };
        await checkIdentity(headers); // no sidecar installed
        await fs.writeFile(sidecar, '');
        await checkIdentity(headers);
        await fs.unlink(sidecar);
        await fs.symlink('ToyCar.bin', sidecar);
        await checkIdentity(headers);
        await fs.unlink(sidecar);
        await fs.writeFile(sidecar, compress(body));
        await checkIdentity({ 'Accept-Encoding': name + ';q=0' });
      }

      for (const [accept, encoding] of [
        ['br;q=0.5, gzip;q=1, identity;q=0.2', 'gzip'],
        ['gzip;q=0.5, br;q=1, identity;q=0.2', 'br']
      ]) {
        const res = await get('ToyCar.bin', { headers: { 'Accept-Encoding': accept } });
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-encoding'], encoding);
      }
      await checkIdentity({ 'Accept-Encoding': 'br;q=0.4, gzip;q=0.9, identity;q=1' });
      const declined = await get('ToyCar.bin', { headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0, identity;q=0' } });
      assert.equal(declined.status, 406);
      assert.match(declined.headers.vary, /\bAccept-Encoding\b/i);
      assert.equal(declined.headers['cache-control'], 'no-store');
      await checkIdentity({}); // no negotiation requested
      const range = await get('ToyCar.bin', { headers: { 'Accept-Encoding': 'identity', Range: 'bytes=1-2' } });
      assert.equal(range.status, 206);
      assert.equal(range.headers['content-encoding'], undefined);
      assert.equal(range.headers['content-range'], 'bytes 1-2/5');
      assert.deepEqual(range.body, body.subarray(1, 3));
    });
  });
});
