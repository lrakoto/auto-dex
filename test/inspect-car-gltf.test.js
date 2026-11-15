const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectCarGltf } = require('../scripts/inspect-car-gltf');

// A generated 2 × 3 RGBA PNG, including its image data and CRCs.
const paint = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAFElEQVR4nGN45mrynz/gxH8GDAYAswoNjVOHFWcAAAAASUVORK5CYII=', 'base64');

function fixture() {
  const geometry = Buffer.alloc(88);
  // The fourth position is deliberately outside the indexed triangle.
  [0, 0, 0, 1, 0, 0, 0, 1, 2, 99, 99, 99].forEach((value, i) => geometry.writeFloatLE(value, i * 4));
  [0, 1, 2].forEach((value, i) => geometry.writeUInt16LE(value, 48 + i * 2));
  [0, 0, 1, 0, 0, 1, 1, 1].forEach((value, i) => geometry.writeFloatLE(value, 56 + i * 4));

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }, { nodes: [2] }],
    nodes: [
      { children: [1], translation: [10, 20, 30], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
      { mesh: 0, translation: [2, 3, 4], scale: [2, 1, 3] },
      { mesh: 0, translation: [1000, 1000, 1000] }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] }],
    buffers: [{ uri: 'mesh.bin', byteLength: geometry.length }],
    bufferViews: [
      { buffer: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 6, target: 34963 },
      { buffer: 0, byteOffset: 56, byteLength: 32, target: 34962 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [99, 99, 99] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' }
    ],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: 'textures/paint.png' }]
  };
  return { gltf, geometry };
}

function glbFile(gltf, bin) {
  function chunk(type, content, padding) {
    const paddedLength = Math.ceil(content.length / 4) * 4;
    const result = Buffer.alloc(8 + paddedLength, padding);
    result.writeUInt32LE(paddedLength, 0);
    result.write(type, 4, 'ascii');
    content.copy(result, 8);
    return result;
  }

  const jsonChunk = chunk('JSON', Buffer.from(JSON.stringify(gltf)), 0x20);
  const binChunk = chunk('BIN\0', bin, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + jsonChunk.length + binChunk.length, 8);
  return Buffer.concat([header, jsonChunk, binChunk]);
}

function assertGeometry(geometry) {
  assert.equal(geometry.triangles, 1);
  // After child scale/translation and parent rotation/translation, the
  // triangle is [7,22,34], [7,24,34], [6,22,40].
  for (const [key, values] of Object.entries({ min: [6, 22, 34], max: [7, 24, 40], dimensions: [1, 2, 6] })) {
    assert.equal(geometry[key].length, 3);
    values.forEach((value, i) => assert.ok(Math.abs(geometry[key][i] - value) < 1e-10, `${key}[${i}] was ${geometry[key][i]}`));
  }
}

describe('Local glTF readiness report', function () {
  let directory;

  beforeEach(async function () {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autodex-inspect-gltf-'));
  });

  afterEach(async function () {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('measures only indexed geometry in the selected scene and totals external file bytes', async function () {
    const { gltf, geometry } = fixture();
    const filename = path.join(directory, 'sample.gltf');
    const json = Buffer.from(JSON.stringify(gltf));
    await fs.mkdir(path.join(directory, 'textures'));
    await Promise.all([
      fs.writeFile(filename, json),
      fs.writeFile(path.join(directory, 'mesh.bin'), geometry),
      fs.writeFile(path.join(directory, 'textures', 'paint.png'), paint)
    ]);

    const report = await inspectCarGltf(filename);
    assert.equal(report.model, 'sample.gltf');
    assertGeometry(report.geometryMetres);
    assert.deepEqual(report.images, [{ source: 'textures/paint.png', format: 'png', width: 2, height: 3, bytes: paint.length }]);
    assert.deepEqual(Object.fromEntries(report.assetFiles.map(({ name, bytes }) => [name, bytes])), {
      'sample.gltf': json.length,
      'mesh.bin': geometry.length,
      [path.join('textures', 'paint.png')]: paint.length
    });
    assert.equal(report.assetBytes, json.length + geometry.length + paint.length);
  });

  it('reads geometry and an embedded image from GLB without double-counting the image bytes', async function () {
    const { gltf, geometry } = fixture();
    const bin = Buffer.concat([geometry, paint]);
    gltf.buffers[0] = { byteLength: bin.length };
    gltf.images[0] = { mimeType: 'image/png', bufferView: 3 };
    gltf.bufferViews.push({ buffer: 0, byteOffset: geometry.length, byteLength: paint.length });
    const filename = path.join(directory, 'embedded.glb');
    const file = glbFile(gltf, bin);
    await fs.writeFile(filename, file);

    const report = await inspectCarGltf(filename);
    assert.equal(report.model, 'embedded.glb');
    assertGeometry(report.geometryMetres);
    assert.deepEqual(report.images, [{ source: 'bufferView 3', format: 'png', width: 2, height: 3, bytes: paint.length }]);
    assert.deepEqual(report.assetFiles, [{ name: 'embedded.glb', bytes: file.length }]);
    assert.equal(report.assetBytes, file.length);
  });

  it('rejects remote and escaped buffer references without attempting to read them', async function () {
    const { gltf } = fixture();
    const filename = path.join(directory, 'outside.gltf');
    for (const uri of ['https://example.invalid/mesh.bin', '%2e%2e/mesh.bin']) {
      gltf.buffers[0].uri = uri;
      await fs.writeFile(filename, JSON.stringify(gltf));
      await assert.rejects(inspectCarGltf(filename), /resources must be relative files inside the model folder/);
    }
  });
});
