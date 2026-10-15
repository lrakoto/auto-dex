const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '../public/js/add-car.js');
const source = readFileSync(scriptPath, 'utf8');
const vin = '1HGCM82633A004352';
const secondVin = '1HGCM82633A004353';

function element(tagName) {
  const listeners = {};
  let value = '';
  const el = {
    tagName: tagName.toUpperCase(), children: [], disabled: false, hidden: false, textContent: '',
    get options() {
      return this.children.flatMap(child => child.tagName === 'OPTGROUP' ? child.children : [child]);
    },
    get value() { return value; },
    set value(next) {
      value = String(next);
      if (this.tagName === 'SELECT' && !this.options.some(opt => opt.value === value)) value = '';
    },
    set innerHTML(html) {
      assert.equal(html, '');
      this.children = [];
      value = '';
    },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, listener) { (listeners[name] ||= []).push(listener); },
    emit(name, event = {}) { (listeners[name] || []).forEach(listener => listener.call(this, event)); }
  };
  return el;
}

function loadForm() {
  const elements = {};
  for (const name of ['makeSelect', 'modelSelect', 'yearSelect']) elements[name] = element('select');
  for (const name of ['vinInput']) elements[name] = element('input');
  for (const name of ['vinDecodeBtn', 'catalogRetryBtn', 'addCarSubmit']) elements[name] = element('button');
  for (const name of ['vinStatus', 'catalogStatus']) elements[name] = element('small');
  const requests = [];
  const document = {
    getElementById(name) { return elements[name] || null; },
    createElement: element
  };
  vm.runInNewContext(source, {
    document,
    fetch(url) {
      return new Promise((resolve, reject) => requests.push({ url, resolve, reject, done: false }));
    }
  }, { filename: scriptPath });
  function take(url) {
    const req = requests.find(request => !request.done && request.url === url);
    assert.ok(req, 'No pending request for ' + url);
    req.done = true;
    return req;
  }
  return {
    elements, requests,
    respond(url, body, ok = true) { take(url).resolve({ ok, json: () => Promise.resolve(body) }); },
    fail(url) { take(url).reject(new Error('offline')); },
    choose(name, value) { elements[name].value = value; elements[name].emit('change'); },
    enterVin(value = vin) {
      elements.vinInput.value = value;
      elements.vinInput.emit('keydown', { key: 'Enter', preventDefault() {} });
    },
    values(name) { return elements[name].options.map(opt => opt.value); }
  };
}

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function makes(form) {
  form.respond('/garage/makes', ['Toyota', 'Honda']);
  await settle();
}

async function honda(form) {
  await makes(form);
  form.choose('makeSelect', 'Honda');
  form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic', 'Accord'] }] });
  await settle();
}

describe('Garage add-car browser flow', function() {
  it('requires enabled current make, model and year selections before Add becomes available', async function() {
    const form = loadForm();
    const el = form.elements;
    assert.equal(el.makeSelect.disabled, true);
    assert.equal(el.addCarSubmit.disabled, true);
    await makes(form);
    form.choose('makeSelect', 'Honda');
    form.respond('/garage/models?make=Honda', { groups: [
      { label: 'Cars', models: ['Civic'] }, { label: 'Motorcycles', models: ['Gold Wing'] }
    ] });
    await settle();
    assert.deepEqual(el.modelSelect.children.slice(1).map(group => group.label), ['Cars', 'Motorcycles']);
    assert.equal(el.addCarSubmit.disabled, true);
    form.choose('modelSelect', 'Civic');
    assert.equal(el.yearSelect.disabled, true);
    form.respond('/garage/years?make=Honda&model=Civic', ['2025', '2024']);
    await settle();
    assert.equal(el.addCarSubmit.disabled, true);
    form.choose('yearSelect', '2024');
    assert.equal(el.addCarSubmit.disabled, false);
    assert.match(el.catalogStatus.textContent, /ready/);
    form.choose('modelSelect', '');
    assert.equal(el.yearSelect.disabled, true);
    assert.equal(el.yearSelect.value, '');
    assert.equal(el.addCarSubmit.disabled, true);
  });

  it('ignores older model responses and errors after a different make is selected', async function() {
    for (const oldFails of [false, true]) {
      const form = loadForm();
      await makes(form);
      form.choose('makeSelect', 'Toyota');
      form.choose('makeSelect', 'Honda');
      form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic'] }] });
      await settle();
      if (oldFails) form.fail('/garage/models?make=Toyota');
      else form.respond('/garage/models?make=Toyota', { groups: [{ label: 'Cars', models: ['Camry'] }] });
      await settle();
      assert.equal(form.elements.makeSelect.value, 'Honda');
      assert.deepEqual(form.values('modelSelect'), ['', 'Civic']);
      assert.equal(form.elements.modelSelect.disabled, false);
      assert.equal(form.elements.catalogRetryBtn.hidden, true);
    }
  });

  it('keeps the latest model years when an earlier years response arrives last', async function() {
    const form = loadForm();
    await honda(form);
    form.choose('modelSelect', 'Civic');
    form.choose('modelSelect', 'Accord');
    form.respond('/garage/years?make=Honda&model=Accord', ['2024']);
    await settle();
    form.choose('yearSelect', '2024');
    form.respond('/garage/years?make=Honda&model=Civic', ['2003']);
    await settle();
    assert.deepEqual(form.values('yearSelect'), ['', '2024']);
    assert.equal(form.elements.yearSelect.value, '2024');
    assert.equal(form.elements.addCarSubmit.disabled, false);
  });

  it('ignores an earlier lookup even when the user returns to the same make', async function() {
    const form = loadForm();
    await makes(form);
    form.choose('makeSelect', 'Honda');
    form.choose('makeSelect', 'Toyota');
    form.choose('makeSelect', 'Honda');
    form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Old result'] }] });
    await settle();
    assert.equal(form.elements.modelSelect.disabled, true);
    assert.deepEqual(form.values('modelSelect'), ['']);
    form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic'] }] });
    await settle();
    assert.equal(form.elements.modelSelect.disabled, false);
    assert.deepEqual(form.values('modelSelect'), ['', 'Civic']);
  });

  it('invalidates pending years immediately when the make is changed', async function() {
    const form = loadForm();
    await honda(form);
    form.choose('modelSelect', 'Civic');
    form.choose('makeSelect', 'Toyota');
    form.respond('/garage/years?make=Honda&model=Civic', ['2003']);
    await settle();
    assert.equal(form.elements.yearSelect.disabled, true);
    assert.deepEqual(form.values('yearSelect'), ['']);
    assert.equal(form.elements.addCarSubmit.disabled, true);
    assert.match(form.elements.catalogStatus.textContent, /Loading models/);
  });

  it('lets failed makes, models and years load again without reloading or clearing other form fields', async function() {
    const form = loadForm();
    const el = form.elements;
    el.vinInput.value = 'keep-my-input';
    form.fail('/garage/makes');
    await settle();
    assert.equal(el.catalogRetryBtn.hidden, false);
    assert.match(el.catalogStatus.textContent, /Could not load makes/);
    el.catalogRetryBtn.emit('click');
    assert.equal(el.catalogRetryBtn.hidden, true);
    await makes(form);
    form.choose('makeSelect', 'Toyota');
    form.fail('/garage/models?make=Toyota');
    await settle();
    assert.equal(el.modelSelect.disabled, true);
    assert.equal(el.catalogRetryBtn.hidden, false);
    el.catalogRetryBtn.emit('click');
    form.respond('/garage/models?make=Toyota', { groups: [{ label: 'Cars', models: ['Camry'] }] });
    await settle();
    form.choose('modelSelect', 'Camry');
    form.respond('/garage/years?make=Toyota&model=Camry', { error: 'Unavailable' }, false);
    await settle();
    assert.equal(el.yearSelect.disabled, true);
    assert.match(el.catalogStatus.textContent, /Could not load years/);
    el.catalogRetryBtn.emit('click');
    form.respond('/garage/years?make=Toyota&model=Camry', ['2020']);
    await settle();
    form.choose('yearSelect', '2020');
    assert.equal(el.addCarSubmit.disabled, false);
    assert.equal(el.catalogRetryBtn.hidden, true);
    assert.equal(el.vinInput.value, 'keep-my-input');
  });

  it('offers recovery for empty or malformed menu responses and keeps Add disabled', async function() {
    const form = loadForm();
    await makes(form);
    form.choose('makeSelect', 'Toyota');
    form.respond('/garage/models?make=Toyota', { groups: [] });
    await settle();
    assert.equal(form.elements.modelSelect.disabled, true);
    assert.equal(form.elements.catalogRetryBtn.hidden, false);
    assert.match(form.elements.catalogStatus.textContent, /No models were found/);
    form.elements.catalogRetryBtn.emit('click');
    form.respond('/garage/models?make=Toyota', { groups: [{ label: 'Cars', models: 'invalid' }] });
    await settle();
    assert.match(form.elements.catalogStatus.textContent, /Could not load models/);
    assert.equal(form.elements.addCarSubmit.disabled, true);
  });

  it('does not duplicate a pending VIN lookup when Enter is pressed again', async function() {
    const form = loadForm();
    await makes(form);
    form.enterVin();
    form.enterVin();
    assert.equal(form.requests.filter(request => request.url.startsWith('/garage/vin?')).length, 1);
    assert.equal(form.elements.vinDecodeBtn.disabled, true);
    assert.equal(form.elements.addCarSubmit.disabled, true);
    form.respond('/garage/vin?vin=' + vin, { knownMake: false, make: 'Other', model: 'Car', year: '2000' });
    await settle();
    assert.equal(form.elements.vinDecodeBtn.disabled, false);
    assert.match(form.elements.vinStatus.textContent, /doesn’t list Other/);
  });

  it('discards an old VIN response after the VIN is edited and another decode starts', async function() {
    const form = loadForm();
    await makes(form);
    form.enterVin();
    form.elements.vinInput.value = secondVin;
    form.elements.vinInput.emit('input');
    assert.equal(form.elements.vinDecodeBtn.disabled, false);
    form.enterVin(secondVin);
    form.respond('/garage/vin?vin=' + vin, { knownMake: true, make: 'Toyota', model: 'Camry', year: '2020' });
    await settle();
    assert.equal(form.elements.makeSelect.value, '');
    assert.equal(form.elements.vinDecodeBtn.disabled, true);
    assert.equal(form.requests.filter(request => request.url.startsWith('/garage/models?')).length, 0);
    form.respond('/garage/vin?vin=' + secondVin, { knownMake: true, make: 'Honda', model: 'Accord', year: '2003' });
    await settle();
    assert.equal(form.elements.makeSelect.value, 'Honda');
    assert.ok(form.requests.some(request => request.url === '/garage/models?make=Honda'));
  });

  it('does not overwrite manual selections when a VIN lookup or its model lookup completes late', async function() {
    for (const duringModels of [false, true]) {
      const form = loadForm();
      await makes(form);
      form.enterVin();
      if (duringModels) {
        form.respond('/garage/vin?vin=' + vin, { knownMake: true, make: 'Honda', model: 'Accord', year: '2003' });
        await settle();
      }
      form.choose('makeSelect', 'Toyota');
      form.respond('/garage/models?make=Toyota', { groups: [{ label: 'Cars', models: ['Camry'] }] });
      await settle();
      if (duringModels) form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic'] }] });
      else form.respond('/garage/vin?vin=' + vin, { knownMake: true, make: 'Honda', model: 'Accord', year: '2003' });
      await settle();
      assert.equal(form.elements.makeSelect.value, 'Toyota');
      assert.deepEqual(form.values('modelSelect'), ['', 'Camry']);
      assert.equal(form.elements.modelSelect.value, '');
      assert.equal(form.elements.vinDecodeBtn.disabled, false);
      assert.equal(form.requests.filter(request => request.url.startsWith('/garage/years?')).length, 0);
      assert.equal(form.elements.addCarSubmit.disabled, true);
    }
  });

  it('fills a decoded model and year missing from menus, enabling Add only after the complete VIN flow', async function() {
    const form = loadForm();
    await makes(form);
    form.enterVin(vin.toLowerCase());
    assert.equal(form.elements.vinInput.value, vin);
    form.respond('/garage/vin?vin=' + vin, { knownMake: true, make: 'Honda', model: 'Accord', year: '2003', trim: 'EX' });
    await settle();
    form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic'] }] });
    await settle();
    assert.equal(form.elements.modelSelect.value, 'Accord');
    assert.equal(form.elements.addCarSubmit.disabled, true);
    form.respond('/garage/years?make=Honda&model=Accord', ['2025']);
    await settle();
    assert.equal(form.elements.yearSelect.value, '2003');
    assert.equal(form.elements.addCarSubmit.disabled, false);
    assert.equal(form.elements.vinDecodeBtn.disabled, false);
    assert.match(form.elements.vinStatus.textContent, /2003 Honda Accord \(EX\)/);
    assert.equal(form.elements.catalogRetryBtn.hidden, true);
  });

  it('cancels VIN prefilling when the user chooses a model during its year lookup', async function() {
    const form = loadForm();
    await makes(form);
    form.enterVin();
    form.respond('/garage/vin?vin=' + vin, { knownMake: true, make: 'Honda', model: 'Accord', year: '2003' });
    await settle();
    form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic', 'Accord'] }] });
    await settle();
    form.choose('modelSelect', 'Civic');
    form.respond('/garage/years?make=Honda&model=Civic', ['2024']);
    await settle();
    form.respond('/garage/years?make=Honda&model=Accord', ['2003']);
    await settle();
    assert.equal(form.elements.modelSelect.value, 'Civic');
    assert.deepEqual(form.values('yearSelect'), ['', '2024']);
    assert.equal(form.elements.yearSelect.value, '');
    assert.equal(form.elements.addCarSubmit.disabled, true);
  });

  it('stops VIN prefilling when its input changes during model or year loading', async function() {
    for (const duringYears of [false, true]) {
      const form = loadForm();
      await makes(form);
      form.enterVin();
      form.respond('/garage/vin?vin=' + vin, { knownMake: true, make: 'Honda', model: 'Accord', year: '2003' });
      await settle();
      if (duringYears) {
        form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic', 'Accord'] }] });
        await settle();
      }
      form.elements.vinInput.value = secondVin;
      form.elements.vinInput.emit('input');
      if (duringYears) form.respond('/garage/years?make=Honda&model=Accord', ['2024']);
      else form.respond('/garage/models?make=Honda', { groups: [{ label: 'Cars', models: ['Civic', 'Accord'] }] });
      await settle();
      assert.equal(form.elements.modelSelect.value, duringYears ? 'Accord' : '');
      assert.equal(form.elements.yearSelect.value, '');
      assert.equal(form.elements.vinDecodeBtn.disabled, false);
      assert.equal(form.elements.addCarSubmit.disabled, true);
      assert.equal(form.elements.vinStatus.textContent, '');
    }
  });
});
