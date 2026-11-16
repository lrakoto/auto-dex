// The local lab fetches its viewer and model only after the visitor opts in.
(function () {
  'use strict';

  const button = document.getElementById('car-3d-load');
  const status = document.getElementById('car-3d-status');
  const stage = document.getElementById('car-3d-stage');
  const poster = document.getElementById('car-3d-poster');
  const controls = document.getElementById('car-3d-controls');
  const zoomIn = document.getElementById('car-3d-zoom-in');
  const zoomOut = document.getElementById('car-3d-zoom-out');
  const reset = document.getElementById('car-3d-reset');
  if (!button || !status || !stage || !poster || !controls || !zoomIn || !zoomOut || !reset) return;

  const { modelUrl, modelAlt } = stage.dataset;
  if (!modelUrl || !modelAlt) return;

  const viewerUrl = '/dev/3d/assets/viewer.min.js';
  const timeoutMs = 20000;
  const defaultOrbit = '35deg 72deg auto';
  const zoomSteps = ['auto', '24deg', '18deg', '12deg'];
  let current;
  let moduleAttempt = 1;
  let modelRetry = 0;
  let zoomLevel = 0;

  function syncZoomControls() {
    zoomIn.setAttribute('aria-disabled', String(zoomLevel === zoomSteps.length - 1));
    zoomOut.setAttribute('aria-disabled', String(zoomLevel === 0));
  }

  function changeZoom(direction) {
    if (stage.dataset.state !== 'ready') return;
    const next = zoomLevel + direction;
    if (next < 0 || next >= zoomSteps.length) return;
    zoomLevel = next;
    current.model.fieldOfView = zoomSteps[zoomLevel];
    syncZoomControls();
  }

  function update(state, label, message) {
    stage.dataset.state = state;
    poster.hidden = state === 'ready';
    controls.hidden = state !== 'ready';
    button.textContent = label;
    status.textContent = message;
  }

  function remove(attempt) {
    clearTimeout(attempt.timer);
    if (attempt.script) attempt.script.remove();
    if (attempt.model) attempt.model.remove();
    current = null;
  }

  function showPoster(attempt, state, label, message) {
    // A focused control can disappear when the viewer falls back to its poster.
    const focused = document.activeElement;
    const returnFocus = stage.contains(focused) || controls.contains(focused);
    remove(attempt);
    update(state, label, message);
    if (returnFocus) button.focus();
  }

  function fail(attempt, message) {
    if (current !== attempt) return;
    // Model-viewer caches failures by URL as well as successful loads.
    if (attempt.model) modelRetry++;
    else if (attempt.script) moduleAttempt++;
    showPoster(attempt, 'error', 'Retry 3D model', message);
  }

  function showModel(attempt) {
    if (current !== attempt) return;
    if (!window.customElements.get('model-viewer')) {
      fail(attempt, 'The 3D viewer could not start.');
      return;
    }

    const model = document.createElement('model-viewer');
    attempt.model = model;
    model.setAttribute('alt', modelAlt);
    model.setAttribute('aria-describedby', 'car-3d-instructions');
    model.setAttribute('aria-hidden', 'true');
    model.setAttribute('camera-controls', '');
    model.setAttribute('camera-orbit', defaultOrbit);
    model.setAttribute('touch-action', 'pan-y');
    model.setAttribute('disable-zoom', '');
    // The built-in Page Up and Page Down controls otherwise still zoom.
    model.setAttribute('zoom-sensitivity', '0');
    model.setAttribute('interaction-prompt', 'none');
    model.setAttribute('loading', 'eager');
    model.inert = true;
    model.addEventListener('load', () => {
      if (current !== attempt) return;
      clearTimeout(attempt.timer);
      model.inert = false;
      model.removeAttribute('aria-hidden');
      zoomLevel = 0;
      syncZoomControls();
      update('ready', 'Show poster', '3D model loaded.');
    }, { once: true });
    model.addEventListener('error', () => {
      fail(attempt, 'The 3D model could not be displayed.');
    }, { once: true });
    stage.appendChild(model);
    const suffix = modelRetry ? '?retry=' + modelRetry : '';
    model.setAttribute('src', modelUrl + suffix);
  }

  function start() {
    if (!window.customElements) {
      update('error', 'Retry 3D model', 'This browser does not support the 3D viewer.');
      return;
    }
    const attempt = {};
    current = attempt;
    update('loading', 'Cancel 3D load', 'Keep viewing the poster while 3D loads.');
    attempt.timer = setTimeout(() => {
      fail(attempt, 'Loading took too long.');
    }, timeoutMs);

    if (window.customElements.get('model-viewer')) {
      showModel(attempt);
      return;
    }

    const script = document.createElement('script');
    attempt.script = script;
    script.type = 'module';
    // Reuse the module URL after cancellation so a pending import is evaluated
    // only once. Change the URL only after an error or timeout.
    const suffix = moduleAttempt > 1 ? '?retry=' + moduleAttempt : '';
    script.src = viewerUrl + suffix;
    script.addEventListener('load', () => showModel(attempt), { once: true });
    script.addEventListener('error', () => {
      if (window.customElements.get('model-viewer')) showModel(attempt);
      else fail(attempt, 'The 3D viewer could not be loaded.');
    }, { once: true });
    document.head.appendChild(script);
  }

  button.addEventListener('click', () => {
    const state = stage.dataset.state;
    if (state === 'loading' || state === 'ready') {
      showPoster(current, 'idle', 'Load 3D model', 'Poster shown.');
    } else start();
  });
  zoomIn.addEventListener('click', () => changeZoom(1));
  zoomOut.addEventListener('click', () => changeZoom(-1));
  reset.addEventListener('click', () => {
    if (stage.dataset.state !== 'ready') return;
    const { model } = current;
    zoomLevel = 0;
    model.fieldOfView = zoomSteps[zoomLevel];
    model.cameraOrbit = defaultOrbit;
    model.cameraTarget = 'auto auto auto';
    model.jumpCameraToGoal();
    syncZoomControls();
  });
  button.hidden = false;
})();
