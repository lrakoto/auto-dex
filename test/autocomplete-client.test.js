const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '../public/js/autocomplete.js');
const source = readFileSync(scriptPath, 'utf8');
const base = 'https://autodex.example/';

function element() {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  return {
    attrs, value: '', style: {}, id: '',
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
    emit(name, properties = {}) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
      (listeners[name] || []).forEach(callback => callback.call(this, event));
      return event;
    },
    scrollIntoView() {},
    closest(selector) { return selector === '.suggest-item' && this.isOption ? this : null; }
  };
}

function decodeAttribute(value) {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
  }[entity]));
}

function loadAutocomplete(count = 1, readyState = 'complete') {
  const document = element();
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  const window = { location: { href: base } };
  const wraps = Array.from({ length: count }, () => {
    const input = element();
    const dropdown = element();
    let html = '';
    let options = [];
    Object.defineProperty(dropdown, 'innerHTML', {
      get() { return html; },
      set(value) {
        html = value;
        options = Array.from(value.matchAll(/<a\b([^>]+)>/g), match => {
          const option = element();
          const attrs = Object.fromEntries(Array.from(match[1].matchAll(/([\w-]+)="([^"]*)"/g), attr => [attr[1], decodeAttribute(attr[2])]));
          Object.assign(option.attrs, attrs);
          option.id = attrs.id;
          option.href = new URL(attrs.href, base).href;
          option.isOption = true;
          return option;
        });
      }
    });
    dropdown.querySelectorAll = () => options;
    const wrap = {
      input, dropdown,
      querySelector(selector) { return selector === 'input[name="q"]' ? input : dropdown; },
      contains(target) { return target === input || target === dropdown || options.includes(target); }
    };
    input.focus = () => {
      if (document.activeElement === input) return;
      const previous = document.activeElement;
      document.activeElement = input;
      if (previous) previous.emit('blur');
      input.emit('focus');
    };
    return wrap;
  });
  document.readyState = readyState;
  document.activeElement = null;
  document.querySelectorAll = () => wraps;
  vm.runInNewContext(source, {
    document, window,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url) { return new Promise((resolve, reject) => requests.push({ url, resolve, reject, done: false })); }
  }, { filename: scriptPath });

  function take(q) {
    const request = requests.find(candidate => !candidate.done && candidate.url === '/suggest?q=' + encodeURIComponent(q));
    assert.ok(request, 'No pending suggestions for ' + q);
    request.done = true;
    return request;
  }
  return {
    wraps, document, window, requests,
    ready() { document.emit('DOMContentLoaded'); },
    runTimers() {
      const pending = Array.from(timers.values());
      timers.clear();
      pending.forEach(callback => callback());
    },
    type(q, index = 0) {
      wraps[index].input.focus();
      wraps[index].input.value = q;
      wraps[index].input.emit('input');
    },
    key(key, index = 0) { return wraps[index].input.emit('keydown', { key }); },
    blur(index = 0) {
      document.activeElement = null;
      wraps[index].input.emit('blur');
    },
    respond(q, body, ok = true) { take(q).resolve({ ok, json: () => Promise.resolve(body) }); },
    fail(q) { take(q).reject(new Error('offline')); },
    options(index = 0) { return wraps[index].dropdown.querySelectorAll('.suggest-item'); },
    open(index = 0) { return wraps[index].input.attrs['aria-expanded'] === 'true'; }
  };
}

const result = (make = 'Honda', model = 'Civic') => ({ makes: [make], models: [{ make, model }] });
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('Search autocomplete browser flow', function () {
  it('initializes after the DOM is ready and debounces to the current query', async function () {
    const page = loadAutocomplete(1, 'loading');
    assert.equal(page.wraps[0].input.attrs.role, undefined);
    page.ready();
    assert.equal(page.wraps[0].input.attrs.role, 'combobox');
    assert.equal(page.wraps[0].dropdown.attrs.role, 'listbox');
    assert.equal(page.wraps[0].input.attrs['aria-controls'], 'suggest-list-0');
    page.type('Ho');
    page.type('Honda');
    page.runTimers();
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].url, '/suggest?q=Honda');
    page.respond('Honda', result());
    await settle();
    assert.equal(page.open(), true);
    assert.equal(page.options().length, 2);
  });

  it('invalidates a pending request when the query is cleared or reduced to one character', async function () {
    for (const q of ['', 'H']) {
      const page = loadAutocomplete();
      page.type('Honda');
      page.runTimers();
      page.type(q);
      page.respond('Honda', result());
      await settle();
      assert.equal(page.open(), false);
      assert.equal(page.options().length, 0);
      page.key('ArrowDown');
      assert.equal(page.open(), false);
    }
  });

  it('removes obsolete rendered options immediately on every input edit', async function () {
    const page = loadAutocomplete();
    page.type('Honda');
    page.runTimers();
    page.respond('Honda', result());
    await settle();
    page.key('ArrowDown');
    assert.equal(page.wraps[0].input.attrs['aria-activedescendant'], 'suggest-list-0-0');
    page.type('Toyota');
    assert.equal(page.open(), false);
    assert.equal(page.options().length, 0);
    assert.equal(page.wraps[0].input.attrs['aria-activedescendant'], undefined);
    const enter = page.key('Enter');
    assert.equal(enter.defaultPrevented, false);
    assert.equal(page.window.location.href, base);
  });

  it('Escape cancels requests and debounce timers before any menu has opened', async function () {
    const page = loadAutocomplete();
    page.type('Honda');
    page.key('Escape');
    page.runTimers();
    assert.equal(page.requests.length, 0);
    page.type('Honda');
    page.runTimers();
    page.key('Escape');
    page.respond('Honda', result());
    await settle();
    assert.equal(page.open(), false);
    assert.equal(page.options().length, 0);
  });

  it('keeps pending results dismissed after outside clicks or focus leaves the input', async function () {
    for (const dismiss of [page => page.document.emit('click', { target: {} }), page => page.blur()]) {
      const page = loadAutocomplete();
      page.type('Honda');
      page.runTimers();
      dismiss(page);
      page.respond('Honda', result());
      await settle();
      assert.equal(page.open(), false);
      assert.equal(page.options().length, 0);
    }
  });

  it('does not reopen a nav search after its value is cleared and focus returns to the trigger', async function () {
    const page = loadAutocomplete();
    page.type('Honda');
    page.runTimers();
    page.wraps[0].input.value = '';
    page.blur();
    page.respond('Honda', result());
    await settle();
    assert.equal(page.open(), false);
    assert.equal(page.options().length, 0);
  });

  it('retries an unfinished lookup on refocus and ignores its older request', async function () {
    const page = loadAutocomplete();
    page.type('Honda');
    page.runTimers();
    page.blur();
    page.wraps[0].input.focus();
    page.runTimers();
    assert.equal(page.requests.length, 2);
    page.respond('Honda', result('Honda', 'Old result'));
    await settle();
    assert.equal(page.open(), false);
    assert.equal(page.options().length, 0);
    page.respond('Honda', result());
    await settle();
    assert.equal(page.open(), true);
    assert.match(page.wraps[0].dropdown.innerHTML, /Civic/);
    assert.doesNotMatch(page.wraps[0].dropdown.innerHTML, /Old result/);
  });

  it('ignores older successful and failed requests after the latest query has results', async function () {
    for (const fails of [false, true]) {
      const page = loadAutocomplete();
      page.type('Honda');
      page.runTimers();
      page.type('Toyota');
      page.runTimers();
      page.respond('Toyota', result('Toyota', 'Camry'));
      await settle();
      if (fails) page.fail('Honda');
      else page.respond('Honda', result());
      await settle();
      assert.equal(page.open(), true);
      assert.match(page.wraps[0].dropdown.innerHTML, /Camry/);
      assert.doesNotMatch(page.wraps[0].dropdown.innerHTML, /Civic/);
    }
  });

  it('uses request generations even when a query is changed and then retyped', async function () {
    const page = loadAutocomplete();
    page.type('Honda');
    page.runTimers();
    page.type('Toyota');
    page.runTimers();
    page.type('Honda');
    page.runTimers();
    page.respond('Honda', result('Honda', 'Old result'));
    await settle();
    assert.equal(page.open(), false);
    page.respond('Honda', result());
    await settle();
    page.fail('Toyota');
    await settle();
    assert.equal(page.open(), true);
    assert.match(page.wraps[0].dropdown.innerHTML, /Civic/);
    assert.doesNotMatch(page.wraps[0].dropdown.innerHTML, /Old result/);
  });

  it('fails closed for unavailable, malformed and empty responses without intercepting ordinary Enter', async function () {
    for (const [body, ok] of [[result(), false], [null, true], [{ makes: 'Honda', models: [] }, true],
      [{ makes: [], models: [null, { make: 'Honda' }] }, true], [{ makes: [], models: [] }, true]]) {
      const page = loadAutocomplete();
      page.type('Honda');
      page.runTimers();
      page.respond('Honda', body, ok);
      await settle();
      assert.equal(page.open(), false);
      assert.equal(page.options().length, 0);
      assert.equal(page.key('Enter').defaultPrevented, false);
    }
  });

  it('preserves escaped labels, encoded links and keyboard or mouse selection semantics', async function () {
    const page = loadAutocomplete();
    const make = 'A & <B> "Car"';
    const model = 'Model / ? "x"';
    page.type('A &');
    page.runTimers();
    page.respond('A &', result(make, model));
    await settle();
    const html = page.wraps[0].dropdown.innerHTML;
    assert.match(html, /A &amp; &lt;B&gt; &quot;Car&quot;/);
    assert.doesNotMatch(html, /<B>/);
    assert.equal(page.options()[1].href, base + 'cars/car?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model));
    assert.equal(page.key('Enter').defaultPrevented, false);
    assert.equal(page.key('ArrowUp').defaultPrevented, true);
    assert.equal(page.options()[1].attrs['aria-selected'], 'true');
    assert.equal(page.wraps[0].input.attrs['aria-activedescendant'], 'suggest-list-0-1');
    page.key('ArrowDown');
    assert.equal(page.options()[0].attrs['aria-selected'], 'true');
    page.wraps[0].dropdown.emit('mouseover', { target: page.options()[1] });
    assert.equal(page.options()[1].attrs['aria-selected'], 'true');
    assert.equal(page.wraps[0].dropdown.emit('mousedown').defaultPrevented, true);
    assert.equal(page.key('Enter').defaultPrevented, true);
    assert.equal(page.window.location.href, page.options()[1].href);
  });

  it('reopens only current cached results on explicit focus or arrow navigation', async function () {
    const page = loadAutocomplete();
    page.type('Honda');
    page.runTimers();
    page.respond('Honda', result());
    await settle();
    page.key('ArrowDown');
    page.key('Escape');
    assert.equal(page.open(), false);
    assert.equal(page.wraps[0].input.attrs['aria-activedescendant'], undefined);
    page.key('ArrowDown');
    assert.equal(page.open(), true);
    page.blur();
    assert.equal(page.open(), false);
    page.wraps[0].input.focus();
    assert.equal(page.open(), true);
    page.blur();
    page.wraps[0].input.value = 'Toyota';
    page.wraps[0].input.focus();
    page.key('ArrowDown');
    assert.equal(page.open(), false);
  });

  it('keeps two search wraps independent and never publishes results into an unfocused input', async function () {
    const page = loadAutocomplete(2);
    page.type('Honda', 0);
    page.runTimers();
    page.type('Toyota', 1);
    page.runTimers();
    page.respond('Honda', result());
    page.respond('Toyota', result('Toyota', 'Camry'));
    await settle();
    assert.equal(page.open(0), false);
    assert.equal(page.options(0).length, 0);
    assert.equal(page.open(1), true);
    assert.equal(page.wraps[1].input.attrs['aria-controls'], 'suggest-list-1');
    page.key('ArrowDown', 1);
    assert.equal(page.wraps[1].input.attrs['aria-activedescendant'], 'suggest-list-1-0');
    page.document.emit('click', { target: page.wraps[1].input });
    assert.equal(page.open(1), true);
  });
});
