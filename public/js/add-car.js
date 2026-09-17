// Cascading make → model → year dropdowns for /garage/add.
// Lives in an external file so the CSP can stay strict (no 'unsafe-inline').
(function () {
  'use strict';

  var makeSelect  = document.getElementById('makeSelect');
  var modelSelect = document.getElementById('modelSelect');
  var yearSelect  = document.getElementById('yearSelect');
  if (!makeSelect || !modelSelect || !yearSelect) return;

  function fill(select, placeholder, values) {
    select.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    values.forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
  }

  fetch('/garage/makes')
    .then(function (r) { return r.json(); })
    .then(function (makes) { fill(makeSelect, 'Select a make', makes); })
    .catch(function () { fill(makeSelect, 'Could not load makes', []); });

  makeSelect.addEventListener('change', function () {
    var make = this.value;
    fill(modelSelect, 'Loading models...', []);
    fill(yearSelect, 'Select a model first', []);
    modelSelect.disabled = true;
    yearSelect.disabled = true;
    if (!make) { fill(modelSelect, 'Select a make first', []); return; }

    fetch('/garage/models?make=' + encodeURIComponent(make))
      .then(function (r) { return r.json(); })
      .then(function (models) {
        fill(modelSelect, 'Select a model', models);
        modelSelect.disabled = false;
      })
      .catch(function () {
        fill(modelSelect, 'Could not load models', []);
      });
  });

  modelSelect.addEventListener('change', function () {
    var make = makeSelect.value;
    var model = this.value;
    fill(yearSelect, 'Loading years...', []);
    yearSelect.disabled = true;
    if (!model) { fill(yearSelect, 'Select a model first', []); return; }

    fetch('/garage/years?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model))
      .then(function (r) { return r.json(); })
      .then(function (years) {
        fill(yearSelect, 'Select a year', years);
        yearSelect.disabled = false;
      })
      .catch(function () {
        fill(yearSelect, 'Could not load years', []);
      });
  });
})();
