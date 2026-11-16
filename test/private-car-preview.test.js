const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { escapeXML } = require('ejs');
const express = require('express');
const request = require('supertest');
const registerDevCar3d = require('../controllers/dev-car-3d');
const { parseGlb } = require('../scripts/inspect-car-gltf');
const { checkEmbeddedModel, createPreviewApp, preparePreviewModel } = require('../scripts/preview-car-glb');

const poster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAFElEQVR4nGN45mrynz/gxH8GDAYAswoNjVOHFWcAAAAASUVORK5CYII=', 'base64');
// A generated 2 × 3 JPEG with encoded pixel data.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIx' +
  'wcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xA' +
  'AUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oA' +
  'DAMBAAIRAxEAPwCWgKmLf//Z', 'base64'
);
const assetUrl = '/dev/3d/assets/';

function triangleFixture() {
  const positions = Buffer.alloc(36);
  positions.writeFloatLE(1, 12);
  positions.writeFloatLE(1, 28);
  const manifest = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }]
  };
  return { manifest, positions };
}

function glbFile(manifest, bin) {
  const json = Buffer.from(JSON.stringify(manifest));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const file = Buffer.alloc(28 + jsonLength + binLength);
  file.write('glTF');
  file.writeUInt32LE(2, 4);
  file.writeUInt32LE(file.length, 8);
  file.writeUInt32LE(jsonLength, 12);
  file.write('JSON', 16);
  file.fill(0x20, 20, 20 + jsonLength);
  json.copy(file, 20);
  file.writeUInt32LE(binLength, 20 + jsonLength);
  file.write('BIN\0', 24 + jsonLength);
  bin.copy(file, 28 + jsonLength);
  return file;
}

function triangleGlb(overrides = {}) {
  const { manifest, positions } = triangleFixture();
  return glbFile({ ...manifest, ...overrides }, positions);
}

function texturedTriangleGlb(changeManifest) {
  const { manifest, positions } = triangleFixture();
  const uv = Buffer.alloc(24);
  uv.writeFloatLE(1, 8);
  uv.writeFloatLE(1, 20);
  const jpegOffset = positions.length + uv.length;
  const pngOffset = jpegOffset + jpeg.length;
  const bin = Buffer.concat([positions, uv, jpeg, poster]);
  manifest.buffers[0].byteLength = bin.length;
  manifest.bufferViews.push(
    { buffer: 0, byteOffset: positions.length, byteLength: uv.length },
    { buffer: 0, byteOffset: pngOffset, byteLength: poster.length },
    { buffer: 0, byteOffset: jpegOffset, byteLength: jpeg.length }
  );
  manifest.accessors.push({ bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' });
  manifest.meshes[0].primitives[0].attributes.TEXCOORD_0 = 1;
  manifest.meshes[0].primitives[0].material = 0;
  manifest.materials = [{
    pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
    emissiveTexture: { index: 1 }, emissiveFactor: [1, 1, 1]
  }];
  manifest.textures = [{ source: 0 }, { source: 1 }];
  manifest.images = [{ mimeType: 'image/png', bufferView: 2 }, { mimeType: 'image/jpeg', bufferView: 3 }];
  changeManifest?.(manifest);
  return glbFile(manifest, bin);
}

describe('Private GLB preview', function () {
  const name = 'Example <Coupé> & "Edition"';
  const creditLabel = 'Artist <Credit> & source';
  const model = triangleGlb();
  let assets, app, server;

  before(async function () {
    assets = await fs.mkdtemp(path.join(os.tmpdir(), 'autodex-private-preview-test-'));
    await Promise.all([
      fs.writeFile(path.join(assets, 'viewer.min.js'), 'export {};'),
      fs.writeFile(path.join(assets, 'model.glb'), model),
      fs.writeFile(path.join(assets, 'model.glb.gz'), gzipSync(model)),
      fs.writeFile(path.join(assets, 'poster.png'), poster),
      fs.writeFile(path.join(assets, 'texture-0.png'), poster),
      fs.writeFile(path.join(assets, 'texture-1.jpg'), jpeg),
      fs.writeFile(path.join(assets, 'private.txt'), 'unlisted file'),
      fs.writeFile(path.join(assets, 'ToyCar.gltf'), '{}')
    ]);
    server = createPreviewApp(assets, {
      name, creditLabel, posterFile: 'poster.png', posterMime: 'image/png',
      textureAssets: [['texture-0.png', 'image/png']]
    })
      .listen(0, '127.0.0.1');
    await once(server, 'listening');
    app = request(server);
  });

  after(async function () {
    try {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
    } finally {
      if (assets) await fs.rm(assets, { recursive: true, force: true });
    }
  });

  it('renders an escaped poster-first preview under the local policy', async function () {
    const res = await app.get('/dev/3d')
      .expect('Cache-Control', 'no-store')
      .expect('X-Robots-Tag', 'noindex')
      .expect(200);
    const policy = res.headers['content-security-policy'];
    assert.match(policy, /(?:^|;)connect-src 'self'(?:;|$)/);
    assert.doesNotMatch(policy, /(?:^|;)upgrade-insecure-requests(?:;|$)/);
    assert.doesNotMatch(policy, /\bblob:/);
    assert.ok(res.text.includes('<h2 id="lab-model">' + escapeXML(name) + '</h2>'));
    assert.ok(res.text.includes(escapeXML(creditLabel)));
    assert.ok(res.text.includes('data-model-alt="' + escapeXML('Interactive 3D model of ' + name) + '"'));
    assert.ok(!res.text.includes(name));
    assert.ok(!res.text.includes(creditLabel));
    assert.match(res.text, /\bdata-model-url="\/dev\/3d\/assets\/model\.glb"/);
    assert.match(res.text, /\bsrc="\/dev\/3d\/assets\/poster\.png"/);
    assert.doesNotMatch(res.text, /texture-0\.png/);
    assert.doesNotMatch(res.text, /<(?:script|link|img|source|model-viewer)\b[^>]*\s(?:src|href)=["'][^"']*(?:model\.glb|viewer\.min\.js)/i);
  });

  it('keeps a private poster visible and provides restart guidance when the model is unavailable', async function () {
    const posterOnly = await fs.mkdtemp(path.join(assets, 'poster-only-'));
    await fs.writeFile(path.join(posterOnly, 'poster.png'), poster);
    const preview = createPreviewApp(posterOnly, { name, creditLabel, posterFile: 'poster.png', posterMime: 'image/png' });
    const res = await request(preview).get('/dev/3d').expect(200);
    assert.match(res.text, /\bsrc="\/dev\/3d\/assets\/poster\.png"/);
    assert.match(res.text, /Restart the private preview with the local model and poster files/);
    assert.doesNotMatch(res.text, /Run the local 3D demo setup|id="car-3d-load"|data-model-url/);
  });

  it('checks the loopback host and serves only allowlisted preview files', async function () {
    for (const url of ['/dev/3d', assetUrl + 'model.glb', assetUrl + 'texture-0.png']) {
      await app.get(url).set('Host', 'preview.example.test').expect(403);
    }
    for (const [file, mime] of [
      ['poster.png', /^image\/png\b/],
      ['texture-0.png', /^image\/png\b/],
      ['viewer.min.js', /^text\/javascript\b/],
      ['model.glb?retry=1', /^model\/gltf-binary\b/]
    ]) {
      await app.get(assetUrl + file).set('Accept-Encoding', 'identity')
        .expect('Content-Type', mime)
        .expect('Cache-Control', 'no-store')
        .expect('X-Robots-Tag', 'noindex')
        .expect(200);
    }
    for (const file of ['private.txt', 'ToyCar.gltf', 'texture-1.jpg', 'model.glb.br', 'model.glb.gz', '..%2Fprivate.txt']) {
      await app.get(assetUrl + file).expect(404);
    }
  });

  it('keeps private GLBs and textures unavailable in the ordinary Toy Car lab', async function () {
    const toyLab = express();
    registerDevCar3d(toyLab, {
      env: { NODE_ENV: 'development', ENABLE_3D_DEMO: '1' },
      assetRoot: assets
    });
    await request(toyLab).get(assetUrl + 'ToyCar.gltf').expect(200);
    await request(toyLab).get(assetUrl + 'model.glb').expect(404);
    await request(toyLab).get(assetUrl + 'texture-0.png').expect(404);
  });

  it('extracts embedded PNG and JPEG textures without changing the binary chunk', function () {
    const input = texturedTriangleGlb();
    const prepared = preparePreviewModel(input);
    assert.deepEqual(prepared.textures, [
      { name: 'texture-0.png', mimeType: 'image/png', bytes: poster },
      { name: 'texture-1.jpg', mimeType: 'image/jpeg', bytes: jpeg }
    ]);
    const { gltf: source } = parseGlb(input);
    const { gltf: output } = parseGlb(prepared.model);
    assert.deepEqual(output.images.map(image => image.uri), ['texture-0.png', 'texture-1.jpg']);
    assert.ok(output.images.every(image => image.bufferView === undefined));
    for (const field of ['meshes', 'buffers', 'bufferViews', 'accessors', 'materials', 'textures']) {
      assert.deepEqual(output[field], source[field], field);
    }
    const binChunk = file => file.subarray(20 + file.readUInt32LE(12));
    assert.deepEqual(binChunk(prepared.model), binChunk(input));
  });

  it('keeps a textureless GLB byte-for-byte and rejects invalid embedded textures', function () {
    assert.deepEqual(preparePreviewModel(model), { model, textures: [] });
    assert.throws(() => preparePreviewModel(texturedTriangleGlb(manifest => {
      // The last image would extend into GLB padding, beyond the declared buffer.
      manifest.bufferViews[2].byteLength++;
    })), /buffer view|range/i);
    assert.throws(() => preparePreviewModel(texturedTriangleGlb(manifest => {
      manifest.images[0].mimeType = 'image/jpeg';
    })), /MIME/i);
    assert.throws(() => preparePreviewModel(triangleGlb({
      images: [{ uri: 'https://assets.example.test/paint.png' }]
    })), /self-contained GLB/);
  });

  it('accepts embedded geometry and rejects external buffers and images', function () {
    assert.doesNotThrow(() => checkEmbeddedModel(model));
    assert.throws(() => checkEmbeddedModel(triangleGlb({
      buffers: [{ byteLength: 36, uri: 'triangle.bin' }]
    })), /self-contained GLB/);
    assert.throws(() => checkEmbeddedModel(triangleGlb({
      images: [{ uri: 'https://assets.example.test/paint.png' }]
    })), /self-contained GLB/);
    for (const extension of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']) {
      assert.throws(() => checkEmbeddedModel(triangleGlb({ extensionsUsed: [extension] })), /Export GLB geometry/);
    }
  });
});
