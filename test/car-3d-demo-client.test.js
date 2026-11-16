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
    emit(type, detail) {
      const listener = listeners.get(type);
      if (!listener) return;
      if (listener.once) listeners.delete(type);
      listener.handler({ target: this, detail });
    },
    remove() { this.removed = true; }
  };
}

function loadDemo({ modelUrl: src = modelUrl, modelAlt = 'Interactive 3D model of the Khronos Toy Car' } = {}) {
  let activeElement = null;
  function focusable() {
    const node = element();
    node.focus = () => { activeElement = node; };
    return node;
  }
  const button = focusable(), stage = element(), poster = element(), status = element();
  const controls = element(), zoomIn = focusable(), zoomOut = focusable(), reset = focusable();
  const credit = focusable();
  const modules = [], models = [], timers = new Map();
  let registered = false, nextTimer = 0;
  let now = 0;
  function expireTimers(until = Infinity) {
    for (const [id, { callback, due }] of timers) {
      if (due > until) continue;
      timers.delete(id);
      callback();
    }
  }
  stage.dataset.state = 'idle';
  stage.dataset.modelUrl = src;
  stage.dataset.modelAlt = modelAlt;
  controls.hidden = button.hidden = true;
  stage.appendChild = model => models.push(model);
  stage.contains = node => models.some(model => model === node && !model.removed);
  controls.contains = node => [zoomIn, zoomOut, reset].includes(node);
  const nodes = {
    'car-3d-load': button, 'car-3d-stage': stage, 'car-3d-poster': poster, 'car-3d-status': status,
    'car-3d-controls': controls, 'car-3d-zoom-in': zoomIn, 'car-3d-zoom-out': zoomOut, 'car-3d-reset': reset
  };
  const customElements = { get: name => registered && name === 'model-viewer' ? function ModelViewer() {} : undefined };
  vm.runInNewContext(source, {
    document: {
      get activeElement() { return activeElement; },
      getElementById: id => nodes[id] || null,
      createElement(tag) {
        const viewer = focusable();
        if (tag === 'model-viewer') Object.assign(viewer, {
          fieldOfView: 'auto', jumps: 0,
          jumpCameraToGoal() { this.jumps++; }
        });
        return viewer;
      },
      head: { appendChild: module => modules.push(module) }
    },
    window: { customElements },
    setTimeout(callback, delay) {
      timers.set(++nextTimer, { callback, due: now + delay });
      return nextTimer;
    },
    clearTimeout(id) { timers.delete(id); }
  }, { filename: scriptPath });
  return {
    button, stage, poster, status, modules, models, controls, zoomIn, zoomOut, reset, credit, timers,
    get activeElement() { return activeElement; },
    click: () => button.emit('click'),
    installViewer(module = modules[0]) { registered = true; module.emit('load'); },
    expireTimers,
    advanceTimers(ms) {
      now += ms;
      expireTimers(now);
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
    assert.equal(demo.status.textContent, 'Poster shown.');
    demo.click();
    const reopened = demo.models[2];
    assert.equal(reopened.src, retry.src);
    assert.equal(demo.modules.length, 1);
    reopened.emit('load');
    assert.equal(demo.stage.dataset.state, 'ready');
  });

  it('offers to keep the poster before the viewer module loads', function() {
    const demo = loadDemo();
    demo.click();
    const [canceledModule] = demo.modules;
    const [{ callback: canceledTimeout }] = demo.timers.values();
    assert.equal(demo.button.textContent, 'Keep poster');
    assert.equal(demo.status.textContent, 'Loading 3D model…');
    assert.notEqual(demo.button.getAttribute('aria-disabled'), 'true');

    demo.click();
    assert.equal(canceledModule.removed, true);
    assert.equal(demo.timers.size, 0);
    assert.equal(demo.stage.dataset.state, 'idle');
    assert.equal(demo.button.textContent, 'Load 3D model');
    assert.equal(demo.status.textContent, 'Poster shown. The 3D download may continue.');
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
    const [{ callback: canceledTimeout }] = demo.timers.values();

    demo.click();
    assert.equal(canceledModel.removed, true);
    assert.equal(demo.timers.size, 0);
    assert.equal(demo.stage.dataset.state, 'idle');
    assert.equal(demo.poster.hidden, false);
    assert.equal(demo.controls.hidden, true);
    assert.equal(demo.status.textContent, 'Poster shown. The 3D download may continue.');

    demo.click();
    assert.equal(demo.models[1].src, canceledModel.src);
    const [retryTimer] = demo.timers.keys();
    canceledModel.emit('progress', { reason: 'model-load', totalProgress: 0.8 });
    assert.deepEqual([...demo.timers.keys()], [retryTimer]);
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

  it('gives the model phase a fresh timeout and allows a slow load that keeps advancing', function() {
    const demo = loadDemo();
    demo.click();
    demo.advanceTimers(19_500);
    demo.installViewer();
    const [model] = demo.models;
    for (const totalProgress of [0.2, 0.45, 0.7]) {
      demo.advanceTimers(19_500);
      assert.equal(demo.stage.dataset.state, 'loading');
      assert.equal(demo.poster.hidden, false);
      model.emit('progress', { reason: 'model-load', totalProgress });
    }
    model.emit('load');
    assert.equal(demo.stage.dataset.state, 'ready');
    model.emit('progress', { reason: 'model-load', totalProgress: 0.95 });
    assert.equal(demo.timers.size, 0);

    demo.advanceTimers(20_000);
    assert.equal(demo.stage.dataset.state, 'ready');
  });

  it('times out a stalled model despite duplicate, regressive, or unrelated progress', function() {
    const demo = loadDemo();
    demo.click();
    demo.installViewer();
    const [model] = demo.models;
    const report = totalProgress => model.emit('progress', { reason: 'model-load', totalProgress });
    demo.advanceTimers(10_000);
    report(0.35);
    demo.advanceTimers(19_999);
    assert.equal(demo.stage.dataset.state, 'loading');

    for (const ignored of [0, 0, 0.1, 0.35, NaN, Infinity, -1, 1, 1.1, '0.7']) report(ignored);
    model.emit('progress');
    model.emit('progress', { reason: 'environment-update', totalProgress: 0.9 });
    demo.advanceTimers(1);

    assert.equal(demo.stage.dataset.state, 'error');
    assert.equal(demo.poster.hidden, false);
    assert.equal(demo.button.textContent, 'Retry 3D model');
  });

  for (const [label, target] of [
    ['the viewer', demo => demo.models[0]],
    ['a camera control', demo => demo.reset]
  ]) {
    it('returns focus to Retry when a ready model fails with focus on ' + label, function() {
      const demo = loadDemo();
      demo.button.focus();
      demo.click();
      demo.installViewer();
      const [model] = demo.models;
      model.emit('load');
      assert.equal(demo.activeElement, demo.button);

      target(demo).focus();
      model.emit('error');
      assert.equal(demo.button.textContent, 'Retry 3D model');
      assert.equal(demo.activeElement, demo.button);
      assert.equal(model.removed, true);
      assert.equal(demo.controls.hidden, true);
      assert.equal(demo.poster.hidden, false);
    });
  }

  it('leaves focus outside the preview on delayed success and subsequent failure', function() {
    const demo = loadDemo();
    demo.button.focus();
    demo.click();
    demo.credit.focus();
    demo.installViewer();
    const [model] = demo.models;
    model.emit('load');
    assert.equal(demo.activeElement, demo.credit);
    model.emit('error');
    assert.equal(demo.stage.dataset.state, 'error');
    assert.equal(demo.activeElement, demo.credit);
  });

  it('returns focus to Load when closing a preview whose model remains focused', function() {
    const demo = loadDemo();
    demo.click();
    demo.installViewer();
    const [model] = demo.models;
    model.emit('load');
    model.focus();

    demo.click();
    assert.equal(demo.button.textContent, 'Load 3D model');
    assert.equal(demo.activeElement, demo.button);
    assert.equal(demo.poster.hidden, false);
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
