// The local lab fetches its viewer and model only after the visitor opts in.
(function () {
  'use strict';

  const button = document.getElementById('car-3d-load');
  const status = document.getElementById('car-3d-status');
  const stage = document.getElementById('car-3d-stage');
  const poster = document.getElementById('car-3d-poster');
  if (!button || !status || !stage || !poster) return;

  const assets = '/dev/3d/assets/';
  const timeoutMs = 20000;
  let current;
  let moduleAttempts = 0;

  function update(state, label, message) {
    stage.dataset.state = state;
    poster.hidden = state === 'ready';
    button.textContent = label;
    if (state === 'loading') button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    status.textContent = message;
  }

  function remove(attempt) {
    clearTimeout(attempt.timer);
    if (attempt.script) attempt.script.remove();
    if (attempt.model) attempt.model.remove();
    current = null;
  }

  function fail(attempt, message) {
    if (current !== attempt) return;
    remove(attempt);
    update('error', 'Retry 3D model', message);
  }

  function showModel(attempt) {
    if (current !== attempt) return;
    if (!window.customElements.get('model-viewer')) {
      fail(attempt, 'The 3D viewer could not start.');
      return;
    }

    const model = document.createElement('model-viewer');
    attempt.model = model;
    model.setAttribute('alt', 'Interactive 3D model of the Khronos Toy Car');
    model.setAttribute('aria-describedby', 'car-3d-instructions');
    model.setAttribute('aria-hidden', 'true');
    model.setAttribute('camera-controls', '');
    model.setAttribute('camera-orbit', '35deg 72deg auto');
    model.setAttribute('touch-action', 'pan-y');
    model.setAttribute('disable-zoom', '');
    model.setAttribute('interaction-prompt', 'none');
    model.setAttribute('loading', 'eager');
    model.inert = true;
    model.addEventListener('load', () => {
      if (current !== attempt) return;
      clearTimeout(attempt.timer);
      model.inert = false;
      model.removeAttribute('aria-hidden');
      update('ready', 'Show poster', '3D model loaded.');
    }, { once: true });
    model.addEventListener('error', () => {
      fail(attempt, 'The 3D model could not be displayed.');
    }, { once: true });
    stage.appendChild(model);
    model.setAttribute('src', assets + 'ToyCar.gltf');
  }

  function start() {
    if (!window.customElements) {
      update('error', 'Retry 3D model', 'This browser does not support the 3D viewer.');
      return;
    }
    const attempt = {};
    current = attempt;
    update('loading', 'Loading 3D model…', 'Keep viewing the poster while 3D loads.');
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
    // A failed module URL can be cached by the browser until reload.
    const suffix = moduleAttempts++ ? '?retry=' + moduleAttempts : '';
    script.src = assets + 'viewer.min.js' + suffix;
    script.addEventListener('load', () => showModel(attempt), { once: true });
    script.addEventListener('error', () => {
      if (window.customElements.get('model-viewer')) showModel(attempt);
      else fail(attempt, 'The 3D viewer could not be loaded.');
    }, { once: true });
    document.head.appendChild(script);
  }

  button.addEventListener('click', () => {
    if (stage.dataset.state === 'loading') return;
    if (stage.dataset.state === 'ready') {
      remove(current);
      update('idle', 'Load 3D model', 'Poster shown.');
    } else start();
  });
  button.hidden = false;
})();
