// Cascading make → model → year dropdowns for /garage/add, plus VIN decode.
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

  // Select a value, adding it as an option first if the list doesn't have it
  // (a decoded VIN can name a model or year outside NHTSA's model list).
  function choose(select, value) {
    var exists = Array.prototype.some.call(select.options, function (o) { return o.value === value; });
    if (!exists) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    }
    select.value = value;
    select.disabled = false;
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body && body.error ? body.error : 'Request failed');
        return body;
      });
    });
  }

  function loadModels(make) {
    fill(modelSelect, 'Loading models...', []);
    fill(yearSelect, 'Select a model first', []);
    modelSelect.disabled = true;
    yearSelect.disabled = true;
    if (!make) { fill(modelSelect, 'Select a make first', []); return Promise.resolve(); }
    return getJSON('/garage/models?make=' + encodeURIComponent(make))
      .then(function (models) {
        fill(modelSelect, 'Select a model', models);
        modelSelect.disabled = false;
      })
      .catch(function () { fill(modelSelect, 'Could not load models', []); });
  }

  function loadYears(make, model) {
    fill(yearSelect, 'Loading years...', []);
    yearSelect.disabled = true;
    if (!model) { fill(yearSelect, 'Select a model first', []); return Promise.resolve(); }
    return getJSON('/garage/years?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model))
      .then(function (years) {
        fill(yearSelect, 'Select a year', years);
        yearSelect.disabled = false;
      })
      .catch(function () { fill(yearSelect, 'Could not load years', []); });
  }

  var makesLoaded = getJSON('/garage/makes')
    .then(function (makes) { fill(makeSelect, 'Select a make', makes); })
    .catch(function () { fill(makeSelect, 'Could not load makes', []); });

  makeSelect.addEventListener('change', function () { loadModels(this.value); });
  modelSelect.addEventListener('change', function () { loadYears(makeSelect.value, this.value); });

  // ── VIN decode ────────────────────────────────────────────────
  var vinInput  = document.getElementById('vinInput');
  var vinBtn    = document.getElementById('vinDecodeBtn');
  var vinStatus = document.getElementById('vinStatus');
  if (!vinInput || !vinBtn || !vinStatus) return;

  function decode() {
    var vin = vinInput.value.trim().toUpperCase();
    vinInput.value = vin;
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      vinStatus.textContent = 'A VIN is 17 letters and numbers (no I, O or Q).';
      return;
    }
    vinBtn.disabled = true;
    vinStatus.textContent = 'Decoding…';
    getJSON('/garage/vin?vin=' + encodeURIComponent(vin))
      .then(function (car) {
        if (!car.knownMake) {
          vinStatus.textContent = 'Decoded as a ' + car.year + ' ' + car.make + ' ' + car.model + ', but AutoDex doesn’t list ' + car.make + ' yet.';
          return;
        }
        return makesLoaded
          .then(function () { choose(makeSelect, car.make); return loadModels(car.make); })
          .then(function () { choose(modelSelect, car.model); return loadYears(car.make, car.model); })
          .then(function () {
            choose(yearSelect, String(car.year));
            var extra = [car.trim, car.bodyClass, car.engine].filter(Boolean).join(' · ');
            vinStatus.textContent = '✓ ' + car.year + ' ' + car.make + ' ' + car.model + (extra ? ' (' + extra + ')' : '');
          });
      })
      .catch(function (err) { vinStatus.textContent = err.message || 'VIN lookup failed.'; })
      .then(function () { vinBtn.disabled = false; });
  }

  vinBtn.addEventListener('click', decode);
  vinInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); decode(); }
  });
})();
