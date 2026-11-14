const assert = require('node:assert/strict');
const trimToyCar = require('../scripts/trim-toy-car');

function sample() {
  // Match the pinned sample's shared views: all indices in one view, positions
  // and normals in another, and UVs in a third, with fabric between car parts.
  const geometry = Buffer.alloc(316);
  const gltf = {
    asset: { version: '2.0', copyright: 'Synthetic CC0 test fixture' },
    extensionsUsed: ['KHR_texture_transform', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_sheen'],
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3] }],
    nodes: [
      { name: 'ToyCar', mesh: 0, scale: [0.0001, 0.0001, 0.0001] },
      { name: 'Fabric', mesh: 1 },
      { name: 'Glass', mesh: 2, rotation: [0.7071068, 0, 0, 0.7071068] },
      { name: 'Camera001', camera: 0 }
    ],
    cameras: [{ type: 'perspective', perspective: { yfov: 0.75, znear: 0.01 } }],
    buffers: [{ uri: 'ToyCar.bin', byteLength: geometry.length }],
    bufferViews: [
      { buffer: 0, byteLength: 26, target: 34963 },
      { buffer: 0, byteOffset: 28, byteLength: 216, byteStride: 12, target: 34962 },
      { buffer: 0, byteOffset: 244, byteLength: 72, byteStride: 8, target: 34962 }
    ],
    accessors: [],
    materials: [
      {
        name: 'ToyCar', pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatTexture: { index: 2 } } }
      },
      {
        name: 'Fabric', normalTexture: { index: 1, extensions: { KHR_texture_transform: { scale: [3, 3] } } },
        extensions: { KHR_materials_sheen: { sheenRoughnessFactor: 0.5 } }
      },
      { name: 'Glass', extensions: { KHR_materials_transmission: { transmissionFactor: 1 } } }
    ],
    textures: [0, 1, 2].map(source => ({ source, sampler: 0 })),
    images: ['ToyCar_basecolor.png', 'Fabric_normal.png', 'ToyCar_clearcoat.png'].map(uri => ({ uri })),
    samplers: [{ magFilter: 9729, minFilter: 9987 }]
  };
  gltf.meshes = ['ToyCar', 'Fabric', 'Glass'].map((name, i) => {
    const indexOffset = [0, 12, 20][i];
    const indexWidth = i === 0 ? 4 : 2;
    const vectorOffset = i * 72;
    const uvOffset = i * 24;
    const first = gltf.accessors.length;
    gltf.accessors.push(
      { bufferView: 0, byteOffset: indexOffset, componentType: indexWidth === 4 ? 5125 : 5123, count: 3, type: 'SCALAR' },
      { bufferView: 1, byteOffset: vectorOffset, componentType: 5126, count: 3, type: 'VEC3', min: [i, 0, 0], max: [i + 1, 1, 0] },
      { bufferView: 1, byteOffset: vectorOffset + 36, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, byteOffset: uvOffset, componentType: 5126, count: 3, type: 'VEC2' }
    );
    [i, (i + 1) % 3, (i + 2) % 3].forEach((vertex, j) => {
      geometry.writeUIntLE(vertex, indexOffset + j * indexWidth, indexWidth);
    });
    [i, 0, 0, i + 1, 0, 0, i, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((value, j) => {
      geometry.writeFloatLE(value, 28 + vectorOffset + j * 4);
    });
    [0, 0, 1 - i / 4, 0, 0, 1].forEach((value, j) => geometry.writeFloatLE(value, 244 + uvOffset + j * 4));
    return {
      name,
      primitives: [{ indices: first, attributes: { POSITION: first + 1, NORMAL: first + 2, TEXCOORD_0: first + 3 }, material: i }]
    };
  });
  return { gltf, geometry };
}

function accessorBytes({ gltf, geometry }, index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const componentSize = { 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  const elementSize = componentSize * { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + accessor.count * elementSize;
  assert.equal(view.buffer, 0);
  assert.equal((view.byteOffset ?? 0) % 4, 0);
  assert.equal(start % componentSize, 0);
  assert.ok(end <= (view.byteOffset ?? 0) + view.byteLength && end <= geometry.length);
  return geometry.subarray(start, end);
}

describe('Trimming the Khronos Toy Car fixture', function() {
  it('repacks the car and glass accessors without changing their geometry bytes', function() {
    const input = sample();
    const originalGeometry = Buffer.from(input.geometry);
    const output = trimToyCar(input.gltf, input.geometry);
    assert.deepEqual(input.geometry, originalGeometry);
    assert.equal(output.gltf.buffers[0].byteLength, output.geometry.length);
    assert.ok(output.geometry.length < input.geometry.length);

    for (const name of ['ToyCar', 'Glass']) {
      const before = input.gltf.meshes.find(mesh => mesh.name === name).primitives[0];
      const after = output.gltf.meshes.find(mesh => mesh.name === name).primitives[0];
      assert.equal(output.gltf.materials[after.material].name, name);
      assert.deepEqual(accessorBytes(output, after.indices), accessorBytes(input, before.indices));
      for (const attr of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        assert.deepEqual(accessorBytes(output, after.attributes[attr]), accessorBytes(input, before.attributes[attr]));
      }
    }
  });

  it('keeps only the visible car scene and remaps its texture references', function() {
    const input = sample();
    const original = JSON.parse(JSON.stringify(input.gltf));
    const { gltf } = trimToyCar(input.gltf, input.geometry);
    assert.deepEqual(input.gltf, original);
    assert.equal(gltf.asset.copyright, original.asset.copyright);
    const names = gltf.scenes[gltf.scene].nodes.map(index => gltf.nodes[index].name);
    assert.deepEqual(names, ['ToyCar', 'Glass']);
    assert.equal(gltf.nodes.length, 2);
    assert.deepEqual(gltf.nodes.find(node => node.name === 'ToyCar').scale, input.gltf.nodes[0].scale);
    assert.deepEqual(gltf.nodes.find(node => node.name === 'Glass').rotation, input.gltf.nodes[2].rotation);
    assert.equal(gltf.cameras?.length || 0, 0);
    assert.ok(!JSON.stringify(gltf).includes('Fabric'));
    assert.deepEqual(new Set(gltf.extensionsUsed), new Set(['KHR_materials_clearcoat', 'KHR_materials_transmission']));

    const body = gltf.materials.find(material => material.name === 'ToyCar');
    const uriReferencedBy = textureInfo => gltf.images[gltf.textures[textureInfo.index].source].uri;
    assert.equal(uriReferencedBy(body.pbrMetallicRoughness.baseColorTexture), 'ToyCar_basecolor.png');
    assert.equal(uriReferencedBy(body.extensions.KHR_materials_clearcoat.clearcoatTexture), 'ToyCar_clearcoat.png');
  });

  it('rejects accessor formats it cannot safely repack', function() {
    const input = sample();
    input.gltf.accessors[1].sparse = { count: 1 };
    assert.throws(() => trimToyCar(input.gltf, input.geometry));
  });
});
