const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '../public/js/puzzle-streak.js');
const key = 'autodex_puzzle_streak_v1';

function storageWith(value = null) {
  return {
    value,
    getItem(name) { assert.equal(name, key); return this.value; },
    setItem(name, data) { assert.equal(name, key); this.value = String(data); }
  };
}

function render(storage, day, result, { hasAnswer = true, blocked = false } = {}) {
  const count = { textContent: '' };
  const section = {
    dataset: { day, result },
    hidden: true,
    querySelector(selector) { return selector === '[data-puzzle-streak-count]' ? count : null; }
  };
  const window = {};
  const context = {
    window,
    document: { querySelector: selector => selector === '[data-puzzle-streak]' && hasAnswer ? section : null }
  };
  const get = () => {
    if (blocked) throw new Error('Storage access is blocked');
    return storage;
  };
  Object.defineProperty(window, 'localStorage', { get });
  Object.defineProperty(context, 'localStorage', { get });
  vm.runInNewContext(readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
  return {
    shows(value) {
      assert.equal(section.hidden, false);
      assert.equal(String(count.textContent), String(value));
    },
    get hidden() { return section.hidden; }
  };
}

describe('Daily puzzle streak in the browser', function() {
  it('records the first win, then extends it across UTC year and month boundaries', function() {
    const year = storageWith();
    render(year, '2026-12-31', 'won').shows(1);
    render(year, '2027-01-01', 'won').shows(2);

    const leap = storageWith();
    render(leap, '2028-02-28', 'won').shows(1);
    render(leap, '2028-02-29', 'won').shows(2);
    render(leap, '2028-03-01', 'won').shows(3);
  });

  it('keeps the first result for each day through reloads and conflicting results', function() {
    const storage = storageWith();
    render(storage, '2026-05-01', 'won').shows(1);
    const afterWin = storage.value;
    render(storage, '2026-05-01', 'won').shows(1);
    render(storage, '2026-05-01', 'lost').shows(1);
    assert.equal(storage.value, afterWin);

    render(storage, '2026-05-02', 'lost').shows(0);
    const afterLoss = storage.value;
    render(storage, '2026-05-02', 'won').shows(0);
    assert.equal(storage.value, afterLoss);
  });

  it('does not let stale pages overwrite a newer completed day', function() {
    const storage = storageWith();
    render(storage, '2026-05-01', 'won').shows(1);
    render(storage, '2026-05-02', 'won').shows(2);
    const current = storage.value;
    render(storage, '2026-05-01', 'lost');
    render(storage, '2026-05-01', 'pending');
    assert.equal(storage.value, current);
    render(storage, '2026-05-03', 'won').shows(3);
  });

  it('starts a new streak after a loss or a skipped day', function() {
    const lost = storageWith();
    render(lost, '2026-05-01', 'won').shows(1);
    render(lost, '2026-05-02', 'lost').shows(0);
    render(lost, '2026-05-03', 'won').shows(1);

    const missed = storageWith();
    render(missed, '2026-05-01', 'won').shows(1);
    render(missed, '2026-05-03', 'won').shows(1);
  });

  it('shows the current or previous day’s streak while a puzzle is pending without recording a result', function() {
    const storage = storageWith();
    render(storage, '2026-05-01', 'pending').shows(0);
    assert.equal(storage.value, null);
    render(storage, '2026-05-01', 'won').shows(1);
    const recorded = storage.value;
    render(storage, '2026-05-01', 'pending').shows(1);
    render(storage, '2026-05-02', 'pending').shows(1);
    render(storage, '2026-05-03', 'pending').shows(0);
    assert.equal(storage.value, recorded);
  });

  it('leaves the display hidden and storage unchanged on invalid page data', function() {
    const storage = storageWith();
    render(storage, '2026-02-27', 'won').shows(1);
    const recorded = storage.value;
    assert.equal(render(storage, '2026-02-30', 'won').hidden, true);
    assert.equal(render(storage, '2026-2-28', 'won').hidden, true);
    assert.equal(render(storage, '2026-02-28', 'other').hidden, true);
    assert.equal(storage.value, recorded);
  });

  it('recovers from malformed or unusable saved data on a completed puzzle', function() {
    for (const bad of ['{invalid', 'null', '{}']) {
      const storage = storageWith(bad);
      render(storage, '2026-05-01', 'won').shows(1);
      render(storage, '2026-05-02', 'won').shows(2);
    }
  });

  it('keeps the streak hidden when storage access, reads, or required writes fail', function() {
    const day = '2026-05-01';
    assert.equal(render(null, day, 'won', { blocked: true }).hidden, true);
    const denied = { ...storageWith(), getItem() { throw new Error('Read denied'); } };
    assert.equal(render(denied, day, 'won').hidden, true);
    const full = { ...storageWith(), setItem() { throw new Error('Quota exceeded'); } };
    assert.equal(render(full, day, 'won').hidden, true);
  });

  it('does not read storage or show a streak when the puzzle has no answer', function() {
    let reads = 0;
    const storage = { ...storageWith(), getItem() { reads++; return null; } };
    assert.equal(render(storage, '2026-05-01', 'won', { hasAnswer: false }).hidden, true);
    assert.equal(reads, 0);
    assert.equal(storage.value, null);
  });
});
