'use strict';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const indexBytes = new Map([[5121, 1], [5123, 2], [5125, 4]]);

function expect(ok, detail) {
  if (!ok) throw new Error('Unsupported or invalid glTF: ' + detail);
}

const isOffset = value => Number.isSafeInteger(value) && value >= 0;

function lookup(items, index, name) {
  expect(Array.isArray(items) && isOffset(index) && index < items.length && items[index], name);
  return items[index];
}

function vector(value, length, name) {
  expect(Array.isArray(value) && value.length === length && value.every(Number.isFinite), name);
  return value;
}

function onlyExtensions(object, supported = []) {
  expect(!object.extensions || Object.keys(object.extensions).every(key => supported.includes(key)),
    'extension on active geometry');
}

function localMatrix(node) {
  if (node.matrix !== undefined) {
    expect(node.translation === undefined && node.rotation === undefined && node.scale === undefined,
      'node has both matrix and TRS');
    const m = vector(node.matrix, 16, 'node matrix');
    expect(m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1, 'non-affine node matrix');
    return m;
  }

  const [tx, ty, tz] = vector(node.translation ?? [0, 0, 0], 3, 'node translation');
  const [sx, sy, sz] = vector(node.scale ?? [1, 1, 1], 3, 'node scale');
  let [x, y, z, w] = vector(node.rotation ?? [0, 0, 0, 1], 4, 'node rotation');
  const norm = Math.hypot(x, y, z, w);
  expect(Math.abs(norm - 1) <= 0.001, 'rotation is not a unit quaternion');
  x /= norm;
  y /= norm;
  z /= norm;
  w /= norm;
  // glTF matrices are column-major and TRS applies scale, then rotation, then translation.
  return [
    sx * (1 - 2 * (y*y + z*z)), sx * 2 * (x*y + z*w), sx * 2 * (x*z - y*w), 0,
    sy * 2 * (x*y - z*w), sy * (1 - 2 * (x*x + z*z)), sy * 2 * (y*z + x*w), 0,
    sz * 2 * (x*z + y*w), sz * 2 * (y*z - x*w), sz * (1 - 2 * (x*x + y*y)), 0,
    tx, ty, tz, 1
  ];
}

function multiply(a, b) {
  return b.map((_, i) => {
    const row = i % 4;
    const column = i - row;
    return a[row] * b[column] + a[row+4] * b[column+1] + a[row+8] * b[column+2] + a[row+12] * b[column+3];
  });
}

function sourceFor(gltf, buffers, index, position) {
  const a = lookup(gltf.accessors, index, 'accessor');
  expect(a.sparse === undefined && !a.normalized, 'sparse or normalized accessor');
  onlyExtensions(a);
  const width = position ? 12 : indexBytes.get(a.componentType);
  const alignment = position ? 4 : width;
  expect(position ? a.type === 'VEC3' && a.componentType === 5126 : a.type === 'SCALAR' && width,
    position ? 'POSITION must be FLOAT VEC3' : 'indices must be unsigned integers');
  expect(isOffset(a.count) && a.count > 0, 'accessor count');

  const view = lookup(gltf.bufferViews, a.bufferView, 'buffer view');
  onlyExtensions(view);
  const stride = view.byteStride ?? width;
  expect(position ? isOffset(stride) && stride >= width && stride <= 252 && stride % 4 === 0
    : view.byteStride === undefined, 'accessor stride');
  const buffer = lookup(gltf.buffers, view.buffer, 'buffer definition');
  const bytes = lookup(buffers, view.buffer, 'buffer data');
  expect(bytes instanceof Uint8Array && isOffset(buffer.byteLength) && buffer.byteLength <= bytes.byteLength,
    'buffer byte length');

  const viewStart = view.byteOffset ?? 0;
  const offset = a.byteOffset ?? 0;
  expect(isOffset(viewStart) && isOffset(offset) && isOffset(view.byteLength) &&
    viewStart <= buffer.byteLength && view.byteLength <= buffer.byteLength - viewStart &&
    offset % alignment === 0 && (viewStart + offset) % alignment === 0 &&
    offset <= view.byteLength && width <= view.byteLength - offset &&
    a.count - 1 <= (view.byteLength - offset - width) / stride, 'accessor byte range');
  const data = new DataView(bytes.buffer, bytes.byteOffset + viewStart + offset, (a.count - 1) * stride + width);
  return { data, stride, width, count: a.count };
}

function children(object, key) {
  const indices = object[key] ?? [];
  expect(Array.isArray(indices), key + ' list');
  return indices;
}

// Measures triangle primitives in the selected authored scene, in world-axis
// glTF metres. Index references decide which positions contribute to bounds.
function measureScene(gltf, buffers) {
  expect(gltf?.asset?.version === '2.0', 'expected glTF 2.0');
  onlyExtensions(gltf, ['KHR_lights_punctual', 'KHR_materials_variants']);
  const sceneIndex = gltf.scene ?? (gltf.scenes?.length === 1 ? 0 : undefined);
  const scene = lookup(gltf.scenes, sceneIndex, 'select a scene unambiguously');
  onlyExtensions(scene);
  const stack = children(scene, 'nodes').map(index => [index, identity]);
  const visited = new Set();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;

  function includeVertex(positions, index, matrix) {
    expect(index < positions.count, 'triangle index is out of range');
    const offset = index * positions.stride;
    const x = positions.data.getFloat32(offset, true);
    const y = positions.data.getFloat32(offset + 4, true);
    const z = positions.data.getFloat32(offset + 8, true);
    for (let axis = 0; axis < 3; axis++) {
      const value = matrix[axis] * x + matrix[axis+4] * y + matrix[axis+8] * z + matrix[axis+12];
      expect(Number.isFinite(value), 'non-finite world position');
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  while (stack.length) {
    const [index, parent] = stack.pop();
    expect(!visited.has(index), 'cycle or reused scene node');
    const node = lookup(gltf.nodes, index, 'node');
    visited.add(index);
    expect(node.skin === undefined && node.weights === undefined, 'skinned or morphed node');
    onlyExtensions(node, ['KHR_lights_punctual']);
    const matrix = multiply(parent, localMatrix(node));
    for (const child of children(node, 'children')) stack.push([child, matrix]);
    if (node.mesh === undefined) continue;

    const mesh = lookup(gltf.meshes, node.mesh, 'mesh');
    onlyExtensions(mesh);
    expect(mesh.weights === undefined, 'mesh morph weights');
    expect(Array.isArray(mesh.primitives) && mesh.primitives.length > 0, 'mesh primitives');
    for (const p of mesh.primitives) {
      expect(p && (p.mode === undefined || p.mode === 4), 'primitive must use TRIANGLES');
      expect(p.targets === undefined, 'primitive morph targets');
      onlyExtensions(p, ['KHR_materials_variants']);
      const positions = sourceFor(gltf, buffers, p.attributes?.POSITION, true);
      const indices = p.indices === undefined ? null : sourceFor(gltf, buffers, p.indices, false);
      const count = indices ? indices.count : positions.count;
      expect(count % 3 === 0, 'incomplete triangle');
      triangles += count / 3;
      expect(Number.isSafeInteger(triangles), 'triangle count overflows');
      for (let i = 0; i < count; i++) {
        const vertex = !indices ? i : indices.width === 1 ? indices.data.getUint8(i)
          : indices.width === 2 ? indices.data.getUint16(i * 2, true) : indices.data.getUint32(i * 4, true);
        includeVertex(positions, vertex, matrix);
      }
    }
  }

  for (const animation of gltf.animations ?? []) {
    for (const channel of animation.channels ?? []) {
      expect(!visited.has(channel.target?.node) && !channel.target?.extensions,
        'animation may change active scene geometry');
    }
  }
  expect(triangles > 0, 'selected scene has no triangles');
  const dimensions = max.map((value, axis) => value - min[axis]);
  expect(dimensions.every(Number.isFinite), 'non-finite world dimensions');
  return { triangles, min, max, dimensions };
}

module.exports = { measureScene };
