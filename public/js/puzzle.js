// Daily car puzzle — fills the guess field's datalist from /puzzle/suggest as
// you type. The form itself is a plain POST, so the puzzle still works with
// this disabled or without JS at all.
(function () {
  'use strict';

  var input = document.getElementById('puzzle-guess');
  var list = document.getElementById('puzzle-suggestions');
  if (!input || !list || !window.fetch) return;

  var timer = null;

  input.addEventListener('input', function () {
    var q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { list.innerHTML = ''; return; }
    timer = setTimeout(function () {
      fetch('/puzzle/suggest?q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          list.innerHTML = '';
          (data.names || []).forEach(function (name) {
            var opt = document.createElement('option');
            opt.value = name;
            list.appendChild(opt);
          });
        })
        .catch(function () { /* the field still works without suggestions */ });
    }, 200);
  });
})();
