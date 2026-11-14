const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { setImmediate: settle } = require('node:timers/promises');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '../public/js/puzzle.js');
const source = readFileSync(scriptPath, 'utf8');

function loadSuggestions() {
  const options = [];
  const requests = [];
  const timers = new Map();
  let onInput;
  let now = 0;
  let timerId = 0;
  const input = { value: '', addEventListener(type, listener) { if (type === 'input') onInput = listener; } };
  const list = {
    set innerHTML(html) { assert.equal(html, ''); options.length = 0; },
    set textContent(text) { assert.equal(text, ''); options.length = 0; },
    replaceChildren(...items) { options.splice(0, options.length, ...items); },
    appendChild(option) { options.push(option); }
  };
  const document = {
    getElementById(id) { return { 'puzzle-guess': input, 'puzzle-suggestions': list }[id] || null; },
    createElement(tag) { assert.equal(tag, 'option'); return {}; }
  };
  function fetch(url) {
    return new Promise(resolve => requests.push({
      url,
      async reply(body, ok = true) {
        resolve({ ok, json: async () => body });
        await settle();
      }
    }));
  }
  vm.runInNewContext(source, {
    document, window: { fetch }, fetch,
    setTimeout(callback, delay) {
      timers.set(++timerId, { callback, time: now + delay });
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); }
  }, { filename: scriptPath });

  return {
    requests,
    options: () => options.map(option => option.value),
    type(value) { input.value = value; onInput(); },
    advance(ms = 200) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.time > now) continue;
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

describe('Daily puzzle suggestions in the browser', function() {
  it('debounces typing and keeps newer suggestions when an earlier request finishes last', async function() {
    const browser = loadSuggestions();
    browser.type('Ho');
    browser.advance(100);
    browser.type('Honda');
    browser.advance(199);
    assert.equal(browser.requests.length, 0);
    browser.advance(1);
    browser.type('Ford');
    browser.advance();
    assert.deepEqual(browser.requests.map(request => request.url), ['/puzzle/suggest?q=Honda', '/puzzle/suggest?q=Ford']);
    await browser.requests[1].reply({ names: ['Ford Focus', 'Ford Mustang'] });
    await browser.requests[0].reply({ names: ['Honda Civic'] });
    assert.deepEqual(browser.options(), ['Ford Focus', 'Ford Mustang']);
  });

  it('clears displayed suggestions immediately and discards a response after clearing the input', async function() {
    const browser = loadSuggestions();
    browser.type('Honda');
    browser.advance();
    await browser.requests[0].reply({ names: ['Honda Civic'] });
    assert.deepEqual(browser.options(), ['Honda Civic']);

    browser.type('Ford');
    assert.deepEqual(browser.options(), []);
    browser.advance();
    browser.type('');
    await browser.requests[1].reply({ names: ['Ford Focus'] });
    browser.advance();
    assert.deepEqual(browser.options(), []);
    assert.equal(browser.requests.length, 2);
  });

  it('ignores stale suggestions for an identical query after deleting and retyping it', async function() {
    const browser = loadSuggestions();
    browser.type('Honda');
    browser.advance();
    browser.type('');
    browser.type(' Honda ');
    await browser.requests[0].reply({ names: ['Honda Civic'] });
    assert.deepEqual(browser.options(), []);

    browser.advance();
    assert.equal(browser.requests[1].url, browser.requests[0].url);
    await browser.requests[1].reply({ names: ['Honda Accord'] });
    assert.deepEqual(browser.options(), ['Honda Accord']);
  });

  it('ignores HTTP errors and malformed payloads, then resumes on the next valid input', async function() {
    const browser = loadSuggestions();
    browser.type('Honda');
    browser.advance();
    await browser.requests[0].reply({ names: ['Honda Civic'] }, false);
    assert.deepEqual(browser.options(), []);

    browser.type('Ford');
    browser.advance();
    await browser.requests[1].reply({ names: 'Ford Focus' });
    assert.deepEqual(browser.options(), []);

    browser.type('Aston Martin');
    browser.advance();
    assert.equal(browser.requests[2].url, '/puzzle/suggest?q=Aston%20Martin');
    await browser.requests[2].reply({ names: ['Aston Martin DB9'] });
    assert.deepEqual(browser.options(), ['Aston Martin DB9']);
  });
});
