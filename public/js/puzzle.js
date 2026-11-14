// Daily car puzzle — suggestions while typing and clipboard copying after
// finishing. The guess form and selectable result still work without JS.
(function () {
  'use strict';

  var shareText = document.getElementById('puzzle-share-text');
  var copy = document.getElementById('puzzle-share-copy');
  var status = document.getElementById('puzzle-share-status');
  if (shareText && copy && status) {
    var clipboard = navigator.clipboard;
    var canCopy = clipboard && typeof clipboard.writeText === 'function';
    if (!canCopy) copy.textContent = 'Select result';
    copy.addEventListener('click', async function () {
      if (canCopy) {
        try {
          await clipboard.writeText(shareText.value);
          status.textContent = 'Result copied.';
          return;
        } catch (e) { /* use manual copying */ }
      }
      shareText.focus();
      shareText.select();
      status.textContent = 'Result selected. Use your device’s Copy command.';
    });
    copy.hidden = false;
  }

  var input = document.getElementById('puzzle-guess');
  var list = document.getElementById('puzzle-suggestions');
  if (!input || !list || !window.fetch) return;

  var timer = null;
  var revision = 0;

  input.addEventListener('input', function () {
    var q = input.value.trim();
    var requestedRevision = ++revision;
    clearTimeout(timer);
    list.innerHTML = '';
    if (q.length < 2) return;
    timer = setTimeout(function () {
      fetch('/puzzle/suggest?q=' + encodeURIComponent(q))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          // Every edit invalidates earlier requests, including deletion and retyping.
          if (requestedRevision !== revision || !data || !Array.isArray(data.names)) return;
          data.names.forEach(function (name) {
            if (typeof name !== 'string' || !name.trim()) return;
            var opt = document.createElement('option');
            opt.value = name;
            list.appendChild(opt);
          });
        })
        .catch(function () { /* the field still works without suggestions */ });
    }, 200);
  });
})();
