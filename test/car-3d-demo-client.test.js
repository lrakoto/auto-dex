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
    getAttribute(name) { return attrs.get(name) ?? null; },
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

function loadDemo({ modelUrl: src = modelUrl, modelAlt = 'Interactive 3D model of the Khronos Toy Car' } = {}) {
  const button = element(), stage = element(), poster = element(), status = element();
  const controls = element(), zoomIn = element(), zoomOut = element(), reset = element();
  const modules = [], models = [], timers = new Map();
  let registered = false, nextTimer = 0;
  stage.dataset.state = 'idle';
  stage.dataset.modelUrl = src;
  stage.dataset.modelAlt = modelAlt;
  controls.hidden = button.hidden = true;
  stage.appendChild = model => models.push(model);
  const nodes = {
    'car-3d-load': button, 'car-3d-stage': stage, 'car-3d-poster': poster, 'car-3d-status': status,
    'car-3d-controls': controls, 'car-3d-zoom-in': zoomIn, 'car-3d-zoom-out': zoomOut, 'car-3d-reset': reset
  };
  const customElements = { get: name => registered && name === 'model-viewer' ? function ModelViewer() {} : undefined };
  vm.runInNewContext(source, {
    document: {
      getElementById: id => nodes[id] || null,
      createElement(tag) {
        const viewer = element();
        if (tag === 'model-viewer') Object.assign(viewer, {
          fieldOfView: 'auto', jumps: 0,
          jumpCameraToGoal() { this.jumps++; }
        });
        return viewer;
      },
      head: { appendChild: module => modules.push(module) }
    },
    window: { customElements },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }
  }, { filename: scriptPath });
  return {
    button, stage, poster, modules, models, controls, zoomIn, zoomOut, reset, timers,
    click: () => button.emit('click'),
    installViewer(module = modules[0]) { registered = true; module.emit('load'); },
    expireTimers() {
      for (const [id, callback] of timers) { timers.delete(id); callback(); }
    }
  };
}

describe('Local 3D viewer in the browser', function() {
  it('uses the configured model URL and alternate text after opt-in', function() {
    const src = '/dev/3d/assets/private-model.glb';
    const alt = 'Interactive 3D model of the private preview';
    const demo = loadDemo({ modelUrl: src, modelAlt: alt });
    assert.deepEqual(demo.models, []);
    demo.click();
    demo.installViewer();
    assert.equal(demo.models[0].src, src);
    assert.equal(demo.models[0].getAttribute('alt'), alt);
    demo.models[0].emit('error');
    demo.click();
    assert.equal(demo.models[1].src, src + '?retry=1');
  });

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

  it('returns to the poster when canceled before the viewer module loads', function() {
    const demo = loadDemo();
    demo.click();
    const [canceledModule] = demo.modules;
    const [canceledTimeout] = demo.timers.values();
    assert.equal(demo.button.textContent, 'Cancel 3D load');
    assert.notEqual(demo.button.getAttribute('aria-disabled'), 'true');

    demo.click();
    assert.equal(canceledModule.removed, true);
    assert.equal(demo.timers.size, 0);
    assert.equal(demo.stage.dataset.state, 'idle');
    assert.equal(demo.button.textContent, 'Load 3D model');
    assert.equal(demo.poster.hidden, false);
    assert.equal(demo.controls.hidden, true);
    canceledTimeout();
    assert.equal(demo.stage.dataset.state, 'idle');

    demo.click();
    const retryModule = demo.modules[1];
    assert.equal(retryModule.src, canceledModule.src);
    demo.installViewer(canceledModule);
    canceledModule.emit('error');
    assert.equal(demo.stage.dataset.state, 'loading');
    assert.deepEqual(demo.models, []);

    retryModule.emit('load');
    demo.models[0].emit('load');
    assert.equal(demo.stage.dataset.state, 'ready');
    assert.equal(demo.poster.hidden, true);
  });

  it('ignores canceled model events while a new load is pending', function() {
    const demo = loadDemo();
    demo.click();
    demo.installViewer();
    const [canceledModel] = demo.models;
    const [canceledTimeout] = demo.timers.values();

    demo.click();
    assert.equal(canceledModel.removed, true);
    assert.equal(demo.timers.size, 0);
    assert.equal(demo.stage.dataset.state, 'idle');
    assert.equal(demo.poster.hidden, false);
    assert.equal(demo.controls.hidden, true);

    demo.click();
    assert.equal(demo.models[1].src, canceledModel.src);
    canceledModel.emit('load');
    canceledModel.emit('error');
    canceledTimeout();
    assert.equal(demo.stage.dataset.state, 'loading');
    assert.equal(demo.poster.hidden, false);
    assert.equal(demo.controls.hidden, true);

    demo.models[1].emit('load');
    assert.equal(demo.stage.dataset.state, 'ready');
    assert.equal(demo.poster.hidden, true);
    assert.equal(demo.controls.hidden, false);
    assert.equal(demo.modules.length, 1);
  });

  it('changes the module URL after an actual module load failure', function() {
    const demo = loadDemo();
    demo.click();
    demo.modules[0].emit('error');
    assert.equal(demo.stage.dataset.state, 'error');
    assert.equal(demo.poster.hidden, false);

    demo.click();
    const retryModule = demo.modules[1];
    assert.equal(retryModule.src, '/dev/3d/assets/viewer.min.js?retry=2');
    demo.installViewer(retryModule);
    demo.models[0].emit('load');
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

  it('offers bounded camera controls only while the model is ready and restores the initial view', function() {
    const demo = loadDemo();
    assert.equal(demo.controls.hidden, true);
    demo.click();
    demo.installViewer();
    const [model] = demo.models;
    assert.equal(demo.controls.hidden, true);
    demo.zoomIn.emit('click');
    assert.equal(model.fieldOfView, 'auto');
    model.emit('load');

    assert.equal(demo.controls.hidden, false);
    assert.equal(demo.zoomOut.getAttribute('aria-disabled'), 'true');
    demo.zoomOut.emit('click');
    assert.equal(model.fieldOfView, 'auto');
    for (const step of ['24deg', '18deg', '12deg']) {
      demo.zoomIn.emit('click');
      assert.equal(model.fieldOfView, step);
    }
    assert.equal(demo.zoomIn.getAttribute('aria-disabled'), 'true');
    demo.zoomIn.emit('click');
    assert.equal(model.fieldOfView, '12deg');
    demo.zoomOut.emit('click');
    assert.equal(model.fieldOfView, '18deg');
    assert.equal(demo.zoomIn.getAttribute('aria-disabled'), 'false');

    model.cameraOrbit = '60deg 80deg 0.5m';
    model.cameraTarget = '0m 0.02m 0m';
    demo.reset.emit('click');
    assert.equal(model.fieldOfView, 'auto');
    assert.equal(model.cameraOrbit, '35deg 72deg auto');
    assert.equal(model.cameraTarget, 'auto auto auto');
    assert.equal(model.jumps, 1);
    assert.equal(demo.zoomOut.getAttribute('aria-disabled'), 'true');

    demo.click();
    assert.equal(demo.controls.hidden, true);
    assert.equal(demo.poster.hidden, false);
    demo.click();
    demo.models[1].emit('load');
    assert.equal(demo.controls.hidden, false);
    demo.models[1].emit('error');
    assert.equal(demo.controls.hidden, true);
    assert.equal(demo.poster.hidden, false);
  });
});
