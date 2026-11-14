'use strict';

// This handles the flat, uncompressed Khronos Toy Car glTF pinned by setup.
// It deliberately rejects other formats rather than guessing at byte layout.
const materialExtensions = new Set(['KHR_materials_clearcoat', 'KHR_materials_transmission']);
const sampleExtensions = new Set([...materialExtensions, 'KHR_texture_transform', 'KHR_materials_sheen']);
const textureSlots = ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture',
  'occlusionTexture', 'emissiveTexture', 'clearcoatTexture', 'clearcoatRoughnessTexture',
  'clearcoatNormalTexture', 'transmissionTexture'];

function expect(ok, detail) {
  if (!ok) throw new Error(`Unsupported Toy Car glTF: ${detail}`);
}

function only(object, keys) {
  return object && typeof object === 'object' && Object.keys(object).every(key => keys.includes(key));
}

function at(array, index, label) {
  expect(Array.isArray(array) && Number.isInteger(index) && index >= 0 && index < array.length, label);
  return array[index];
}

const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const align4 = value => Math.ceil(value / 4) * 4;

module.exports = function trimToyCar(input, source) {
  expect(only(input, ['asset', 'scene', 'scenes', 'nodes', 'cameras', 'meshes', 'materials',
    'textures', 'images', 'samplers', 'accessors', 'bufferViews', 'buffers', 'extensionsUsed',
    'extensionsRequired']) && input.asset?.version === '2.0', 'asset schema');
  expect(input.scene === 0 && input.scenes?.length === 1 && only(input.scenes[0], ['nodes']),
    'expected one default scene');
  expect((input.extensionsRequired === undefined || input.extensionsRequired.length === 0)
    && (input.extensionsUsed || []).every(extension => sampleExtensions.has(extension)), 'unknown extensions');
  expect(Buffer.isBuffer(source) && input.buffers?.length === 1
    && input.buffers[0].uri === 'ToyCar.bin' && input.buffers[0].byteLength === source.length, 'buffer');

  const g = JSON.parse(JSON.stringify(input));
  const roots = g.scenes[0].nodes;
  expect(Array.isArray(roots) && roots.length === g.nodes?.length
    && new Set(roots).size === roots.length && g.meshes?.length === 3, 'scene roots');
  const nodes = new Map();
  for (const index of roots) {
    const node = at(g.nodes, index, 'node');
    expect(only(node, ['name', 'mesh', 'camera', 'translation', 'rotation', 'scale']), 'nested or unsupported node');
    if (node.camera !== undefined) {
      expect(node.mesh === undefined && /^Camera\d+$/.test(node.name), 'camera node');
      at(g.cameras, node.camera, 'camera');
    } else {
      expect(['ToyCar', 'Fabric', 'Glass'].includes(node.name) && !nodes.has(node.name), 'mesh node');
      expect(at(g.meshes, node.mesh, 'mesh').name === node.name, 'mesh name');
      nodes.set(node.name, node);
    }
  }
  expect(nodes.size === 3 && g.materials?.length === 3, 'expected body, backdrop and glass');

  const result = { asset: g.asset, scene: 0, scenes: [{ nodes: [0, 1] }], nodes: [],
    meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [],
    textures: [], images: [], samplers: [] };
  const chunks = [];
  let length = 0;
  const extensions = new Set();

  function pack(index, type, componentTypes, components, target) {
    const a = at(g.accessors, index, 'accessor');
    expect(only(a, ['name', 'bufferView', 'byteOffset', 'componentType', 'count', 'type', 'min', 'max'])
      && a.type === type && componentTypes.includes(a.componentType) && nonnegative(a.count) && a.count > 0,
    'accessor encoding');
    const v = at(g.bufferViews, a.bufferView, 'buffer view');
    const componentBytes = a.componentType === 5123 ? 2 : 4;
    const stride = componentBytes * components;
    const start = v.byteOffset ?? 0;
    const offset = a.byteOffset ?? 0;
    const size = a.count * stride;
    expect(v.buffer === 0 && v.target === target && v.extensions === undefined
      && (v.byteStride === undefined || v.byteStride === stride)
      && [start, offset, size, v.byteLength].every(nonnegative)
      && start % 4 === 0 && offset % componentBytes === 0
      && start <= source.length && v.byteLength <= source.length - start
      && offset <= v.byteLength && size <= v.byteLength - offset, 'packed byte range');
    const payload = source.subarray(start + offset, start + offset + size);
    const aligned = align4(length);
    if (aligned !== length) chunks.push(Buffer.alloc(aligned - length));
    chunks.push(payload);
    length = aligned + size;
    const accessor = { ...a, bufferView: result.bufferViews.length };
    delete accessor.byteOffset;
    result.bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength: size, target });
    result.accessors.push(accessor);
    return { index: result.accessors.length - 1, count: a.count, componentBytes, payload };
  }

  function compact(array, output, label, transform) {
    const remaps = new Map();
    return index => {
      if (!remaps.has(index)) {
        const item = transform(at(array, index, label));
        remaps.set(index, output.push(item) - 1);
      }
      return remaps.get(index);
    };
  }

  const keepImage = compact(g.images, result.images, 'image', image => {
    expect(only(image, ['uri', 'name']) && /^[\w-]+\.png$/.test(image.uri)
      && !image.uri.startsWith('Fabric_'), 'external texture path');
    return image;
  });
  const keepSampler = compact(g.samplers, result.samplers, 'sampler', sampler => {
    expect(only(sampler, ['magFilter', 'minFilter', 'wrapS', 'wrapT', 'name']), 'sampler layout');
    return sampler;
  });
  const keepTexture = compact(g.textures, result.textures, 'texture', texture => {
    expect(only(texture, ['source', 'sampler', 'name']), 'texture layout');
    return { ...texture, source: keepImage(texture.source),
      ...(texture.sampler === undefined ? {} : { sampler: keepSampler(texture.sampler) }) };
  });

  function remapMaterial(container) {
    for (const [key, value] of Object.entries(container)) {
      if (textureSlots.includes(key)) {
        expect(only(value, ['index', 'texCoord', 'scale', 'strength']), 'material texture layout');
        value.index = keepTexture(value.index);
      } else if (key === 'pbrMetallicRoughness') {
        remapMaterial(value);
      } else if (key === 'extensions') {
        for (const [extension, content] of Object.entries(value)) {
          expect(materialExtensions.has(extension), 'retained material extension');
          extensions.add(extension);
          remapMaterial(content);
        }
      }
    }
  }

  for (const name of ['ToyCar', 'Glass']) {
    const node = nodes.get(name);
    const mesh = g.meshes[node.mesh];
    expect(only(mesh, ['name', 'primitives']) && mesh.primitives?.length === 1, 'mesh layout');
    const p = mesh.primitives[0];
    expect(only(p, ['attributes', 'indices', 'material', 'mode']) && (p.mode === undefined || p.mode === 4)
      && only(p.attributes, ['POSITION', 'NORMAL', 'TEXCOORD_0']), 'primitive layout');
    const material = at(g.materials, p.material, 'material');
    expect(material.name === name, 'material name');
    const indices = pack(p.indices, 'SCALAR', [5123, 5125], 1, 34963);
    const pos = pack(p.attributes.POSITION, 'VEC3', [5126], 3, 34962);
    const normal = pack(p.attributes.NORMAL, 'VEC3', [5126], 3, 34962);
    const uv = pack(p.attributes.TEXCOORD_0, 'VEC2', [5126], 2, 34962);
    expect(pos.count === normal.count && pos.count === uv.count && indices.count % 3 === 0, 'triangle counts');
    for (let offset = 0; offset < indices.payload.length; offset += indices.componentBytes) {
      expect(indices.payload.readUIntLE(offset, indices.componentBytes) < pos.count, 'vertex index');
    }
    remapMaterial(material);
    result.nodes.push({ ...node, mesh: result.meshes.length });
    result.meshes.push({ ...mesh, primitives: [{ ...p, indices: indices.index,
      attributes: { POSITION: pos.index, NORMAL: normal.index, TEXCOORD_0: uv.index },
      material: result.materials.length }] });
    result.materials.push(material);
  }
  if (extensions.size) result.extensionsUsed = [...extensions];
  const geometry = Buffer.concat(chunks, align4(length));
  result.buffers.push({ uri: 'ToyCar.bin', byteLength: geometry.length });
  return { gltf: result, geometry };
};
