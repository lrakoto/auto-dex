const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '../public/js/car-3d-demo.js');
const source = readFileSync(scriptPath, 'utf8');
const modelUrl = '/dev/3d/assets/ToyCar.gltf';

function element() {
  const attrs = new Map();
  const listeners = new Map();
  return {
    dataset: {}, hidden: false,
    get src() { return attrs.get('src'); },
    set src(value) { attrs.set('src', value); },
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    addEventListener(type, handler, { once } = {}) { listeners.set(type, { handler, once }); },
    emit(type) {
      const listener = listeners.get(type);
      if (!listener) return;
      if (listener.once) listeners.delete(type);
      listener.handler({ target: this });
    },
    remove() { this.removed = true; }
  };
}

function loadDemo() {
  const button = element(), stage = element(), poster = element(), status = element();
  const modules = [], models = [], timers = new Map();
  let registered = false, nextTimer = 0;
  stage.dataset.state = 'idle';
  button.hidden = true;
  stage.appendChild = model => models.push(model);
  const nodes = { 'car-3d-load': button, 'car-3d-stage': stage, 'car-3d-poster': poster, 'car-3d-status': status };
  const customElements = { get: name => registered && name === 'model-viewer' ? function ModelViewer() {} : undefined };
  vm.runInNewContext(source, {
    document: {
      getElementById: id => nodes[id] || null,
      createElement: element,
      head: { appendChild: module => modules.push(module) }
    },
    window: { customElements },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }
  }, { filename: scriptPath });
  return {
    button, stage, poster, modules, models,
    click: () => button.emit('click'),
    installViewer() { registered = true; modules[0].emit('load'); },
    expireTimers() {
      for (const [id, callback] of timers) { timers.delete(id); callback(); }
    }
  };
}

describe('Local 3D viewer in the browser', function() {
  it('repairs a failed model download with a new cache key and reuses the successful key on reopen', function() {
    const demo = loadDemo();
    assert.equal(demo.button.hidden, false);
    assert.equal(demo.poster.hidden, false);
    assert.deepEqual(demo.modules, []);
    assert.deepEqual(demo.models, []);

    demo.click();
    assert.equal(demo.modules[0].src, '/dev/3d/assets/viewer.min.js');
    assert.deepEqual(demo.models, []);
    demo.installViewer();
    const failed = demo.models[0];
    assert.equal(failed.src, modelUrl);
    failed.emit('error');
    assert.equal(demo.stage.dataset.state, 'error');
    assert.equal(demo.poster.hidden, false);
    assert.match(demo.button.textContent, /Retry/);

    demo.click();
    const retry = demo.models[1];
    assert.equal(retry.src, modelUrl + '?retry=1');
    retry.emit('load');
    assert.equal(demo.stage.dataset.state, 'ready');
    assert.equal(demo.poster.hidden, true);

    demo.click();
    assert.equal(demo.poster.hidden, false);
    demo.click();
    const reopened = demo.models[2];
    assert.equal(reopened.src, retry.src);
    assert.equal(demo.modules.length, 1);
    reopened.emit('load');
    assert.equal(demo.stage.dataset.state, 'ready');
  });

  it('keeps the poster visible when a timed-out model fires load during a retry', function() {
    const demo = loadDemo();
    demo.click();
    demo.installViewer();
    const stalled = demo.models[0];
    demo.expireTimers();
    assert.equal(demo.stage.dataset.state, 'error');
    assert.equal(demo.poster.hidden, false);

    demo.click();
    stalled.emit('load');
    assert.equal(demo.stage.dataset.state, 'loading');
    assert.equal(demo.poster.hidden, false);

    demo.models[1].emit('load');
    assert.equal(demo.stage.dataset.state, 'ready');
    assert.equal(demo.poster.hidden, true);
  });
});
