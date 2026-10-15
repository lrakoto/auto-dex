// Cascading make → model → year dropdowns for /garage/add, plus VIN decode.
// Lives in an external file so the CSP can stay strict (no 'unsafe-inline').
(function () {
  'use strict';

  var makeSelect = document.getElementById('makeSelect');
  var modelSelect = document.getElementById('modelSelect');
  var yearSelect = document.getElementById('yearSelect');
  if (!makeSelect || !modelSelect || !yearSelect) return;

  var catalogStatus = document.getElementById('catalogStatus');
  var retryBtn = document.getElementById('catalogRetryBtn');
  var submitBtn = document.getElementById('addCarSubmit');
  var retryLookup = null;
  var makesRequest = 0, modelsRequest = 0, yearsRequest = 0;
  var modelsMake = null, yearsMake = null, yearsModel = null;
  var vinRequest = 0, vinPending = false;

  function updateSubmit() {
    if (!submitBtn) return;
    submitBtn.disabled = vinPending || makeSelect.disabled || modelSelect.disabled || yearSelect.disabled ||
      !makeSelect.value || !modelSelect.value || !yearSelect.value ||
      modelsMake !== makeSelect.value || yearsMake !== makeSelect.value || yearsModel !== modelSelect.value;
  }

  function status(message, retry) {
    if (catalogStatus) catalogStatus.textContent = message;
    retryLookup = retry || null;
    if (retryBtn) retryBtn.hidden = !retryLookup;
  }

  function option(value) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    return opt;
  }

  function fill(select, placeholder, values) {
    select.innerHTML = '';
    select.appendChild(option(''));
    select.options[0].textContent = placeholder;
    values.forEach(function (value) { select.appendChild(option(value)); });
  }

  function validList(values) {
    return Array.isArray(values) && values.every(function (value) { return typeof value === 'string' && value.trim(); });
  }

  // A make with only one vehicle type gets a plain list.
  function fillGroups(select, placeholder, groups) {
    if (groups.length < 2) return fill(select, placeholder, groups.length ? groups[0].models : []);
    fill(select, placeholder, []);
    groups.forEach(function (group) {
      var el = document.createElement('optgroup');
      el.label = group.label;
      group.models.forEach(function (value) { el.appendChild(option(value)); });
      select.appendChild(el);
    });
  }

  // VINs can identify a model or year missing from the catalog's menus.
  function choose(select, value) {
    value = String(value);
    var exists = Array.prototype.some.call(select.options, function (o) { return o.value === value; });
    if (!exists) select.appendChild(option(value));
    select.value = value;
    select.disabled = false;
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      return r.json().catch(function () {
        throw new Error('The lookup is unavailable. Please try again.');
      }).then(function (body) {
        if (!r.ok) throw new Error(body && typeof body.error === 'string' ? body.error : 'The lookup is unavailable. Please try again.');
        return body;
      });
    });
  }

  function loadModels(make) {
    var request = ++modelsRequest;
    ++yearsRequest;
    modelsMake = yearsMake = yearsModel = null;
    fill(modelSelect, make ? 'Loading models...' : 'Select a make first', []);
    fill(yearSelect, 'Select a model first', []);
    modelSelect.disabled = yearSelect.disabled = true;
    updateSubmit();
    status(make ? 'Loading models…' : 'Choose a make to find your model.');
    if (!make) return Promise.resolve();
    function current() { return request === modelsRequest && makeSelect.value === make; }
    function retry() { return loadModels(make); }
    return getJSON('/garage/models?make=' + encodeURIComponent(make))
      .then(function (data) {
        if (!current()) return;
        var groups = data && data.groups;
        if (!Array.isArray(groups) || !groups.every(function (group) {
          return group && typeof group.label === 'string' && validList(group.models);
        })) throw new Error('Invalid models');
        var count = groups.reduce(function (total, group) { return total + group.models.length; }, 0);
        fillGroups(modelSelect, count ? 'Select a model' : 'No models found', groups);
        modelsMake = make;
        modelSelect.disabled = !count;
        status(count ? 'Choose a model to find its available years.' : 'No models were found. Retry or use a VIN to fill in your vehicle.', count ? null : retry);
        updateSubmit();
      })
      .catch(function () {
        if (!current()) return;
        fill(modelSelect, 'Could not load models', []);
        status('Could not load models. Check your connection and retry.', retry);
        updateSubmit();
      });
  }

  function loadYears(make, model) {
    var request = ++yearsRequest;
    yearsMake = yearsModel = null;
    fill(yearSelect, model ? 'Loading years...' : 'Select a model first', []);
    yearSelect.disabled = true;
    updateSubmit();
    status(model ? 'Loading years…' : 'Choose a model to find its available years.');
    if (!model) return Promise.resolve();
    function current() { return request === yearsRequest && makeSelect.value === make && modelSelect.value === model; }
    function retry() { return loadYears(make, model); }
    return getJSON('/garage/years?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model))
      .then(function (years) {
        if (!current()) return;
        if (!validList(years)) throw new Error('Invalid years');
        fill(yearSelect, years.length ? 'Select a year' : 'No years found', years);
        yearsMake = make;
        yearsModel = model;
        yearSelect.disabled = !years.length;
        status(years.length ? 'Choose a year to finish your vehicle details.' : 'No years were found. Retry or use a VIN to fill in your vehicle.', years.length ? null : retry);
        updateSubmit();
      })
      .catch(function () {
        if (!current()) return;
        fill(yearSelect, 'Could not load years', []);
        status('Could not load years. Check your connection and retry.', retry);
        updateSubmit();
      });
  }

  function loadMakes() {
    var request = ++makesRequest;
    ++modelsRequest;
    ++yearsRequest;
    modelsMake = yearsMake = yearsModel = null;
    fill(makeSelect, 'Loading makes...', []);
    fill(modelSelect, 'Select a make first', []);
    fill(yearSelect, 'Select a model first', []);
    makeSelect.disabled = modelSelect.disabled = yearSelect.disabled = true;
    status('Loading makes…');
    updateSubmit();
    return getJSON('/garage/makes')
      .then(function (makes) {
        if (request !== makesRequest) return;
        if (!validList(makes) || !makes.length) throw new Error('Invalid makes');
        fill(makeSelect, 'Select a make', makes);
        makeSelect.disabled = false;
        status('Choose a make to find your model.');
        updateSubmit();
      })
      .catch(function () {
        if (request !== makesRequest) return;
        fill(makeSelect, 'Could not load makes', []);
        status('Could not load makes. Check your connection and retry.', function () {
          makesLoaded = loadMakes();
        });
        updateSubmit();
      });
  }

  var vinInput = document.getElementById('vinInput');
  var vinBtn = document.getElementById('vinDecodeBtn');
  var vinStatus = document.getElementById('vinStatus');

  function cancelVin(message) {
    ++vinRequest;
    if (vinPending && vinStatus) vinStatus.textContent = message;
    vinPending = false;
    if (vinBtn) vinBtn.disabled = false;
    updateSubmit();
  }

  if (retryBtn) retryBtn.addEventListener('click', function () {
    var retry = retryLookup;
    if (!retry) return;
    cancelVin('Vehicle lookup canceled. Decode again to fill in your vehicle.');
    retry();
  });
  makeSelect.addEventListener('change', function () {
    cancelVin('Selection changed. Decode again to fill in your vehicle.');
    loadModels(this.value);
  });
  modelSelect.addEventListener('change', function () {
    cancelVin('Selection changed. Decode again to fill in your vehicle.');
    loadYears(makeSelect.value, this.value);
  });
  yearSelect.addEventListener('change', function () {
    cancelVin('Selection changed. Decode again to fill in your vehicle.');
    if (!yearSelect.disabled && yearsMake === makeSelect.value && yearsModel === modelSelect.value) {
      status(yearSelect.value ? 'Vehicle details are ready. Review them before adding.' : 'Choose a year to finish your vehicle details.');
    }
    updateSubmit();
  });

  var makesLoaded = loadMakes();
  if (!vinInput || !vinBtn || !vinStatus) return;

  function decode() {
    // Enter can still reach this handler while the Decode button is disabled.
    if (vinPending) return;
    var vin = vinInput.value.trim().toUpperCase();
    vinInput.value = vin;
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      vinStatus.textContent = 'A VIN is 17 letters and numbers (no I, O or Q).';
      return;
    }
    var request = ++vinRequest;
    function current() { return request === vinRequest && vinInput.value.trim().toUpperCase() === vin; }
    vinPending = true;
    vinBtn.disabled = true;
    vinStatus.textContent = 'Decoding…';
    updateSubmit();
    getJSON('/garage/vin?vin=' + encodeURIComponent(vin))
      .then(function (car) {
        if (!current()) return;
        if (!car || !car.make || !car.model || !car.year) throw new Error('The VIN lookup returned incomplete vehicle details.');
        if (!car.knownMake) {
          vinStatus.textContent = 'Decoded as a ' + car.year + ' ' + car.make + ' ' + car.model + ', but AutoDex doesn’t list ' + car.make + ' yet.';
          return;
        }
        return makesLoaded
          .then(function () {
            if (!current()) return;
            choose(makeSelect, car.make);
            return loadModels(car.make);
          })
          .then(function () {
            if (!current()) return;
            choose(modelSelect, car.model);
            modelsMake = car.make;
            return loadYears(car.make, car.model);
          })
          .then(function () {
            if (!current()) return;
            choose(yearSelect, car.year);
            yearsMake = car.make;
            yearsModel = car.model;
            status('Vehicle details filled in from your VIN. Review them before adding.');
            var extra = [car.trim, car.bodyClass, car.engine].filter(Boolean).join(' · ');
            vinStatus.textContent = '✓ ' + car.year + ' ' + car.make + ' ' + car.model + (extra ? ' (' + extra + ')' : '');
          });
      })
      .catch(function (err) {
        if (current()) vinStatus.textContent = err.message || 'VIN lookup failed. Please try again.';
      })
      .then(function () {
        if (request !== vinRequest) return;
        vinPending = false;
        vinBtn.disabled = false;
        updateSubmit();
      });
  }

  vinBtn.addEventListener('click', decode);
  vinInput.addEventListener('input', function () {
    cancelVin('VIN changed. Decode again to fill in your vehicle.');
    vinStatus.textContent = '';
  });
  vinInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); decode(); }
  });
})();
