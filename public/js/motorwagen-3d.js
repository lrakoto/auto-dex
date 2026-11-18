(() => {
  const toggle = document.getElementById('motorwagen-toggle');
  const stage = document.getElementById('motorwagen-stage');
  const poster = document.getElementById('motorwagen-poster');
  let viewer = null;

  toggle.addEventListener('click', () => {
    if (viewer) {
      viewer.remove();
      viewer = null;
    } else {
      viewer = document.createElement('iframe');
      viewer.title = 'Interactive Benz Patent-Motorwagen No. 1';
      viewer.referrerPolicy = 'no-referrer';
      viewer.allowFullscreen = true;
      viewer.src = `${toggle.dataset.embed}?autostart=1`;
      stage.append(viewer);
    }
    poster.hidden = Boolean(viewer);
    toggle.setAttribute('aria-expanded', String(Boolean(viewer)));
    toggle.textContent = viewer ? 'Return to photo' : 'Load 3D model';
  });
  toggle.hidden = false;
})();
