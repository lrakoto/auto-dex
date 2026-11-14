// Daily Puzzle win streak, stored on this browser only.
(function () {
  'use strict';

  var section = document.querySelector('[data-puzzle-streak]');
  if (!section) return;
  var countElement = section.querySelector('[data-puzzle-streak-count]');
  if (!countElement) return;

  var key = 'autodex_puzzle_streak_v1';
  var day = section.dataset.day;
  var result = section.dataset.result;
  var today = dayNumber(day);
  if (!Number.isFinite(today) || !['pending', 'won', 'lost'].includes(result)) return;

  function dayNumber(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    var date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return NaN;
    return date.getTime() / 86400000;
  }

  function readRecord(raw) {
    try {
      var record = JSON.parse(raw);
      if (!record || !Number.isFinite(dayNumber(record.day)) || !Number.isSafeInteger(record.count)) return null;
      if (record.result === 'won' && record.count > 0) return record;
      if (record.result === 'lost' && record.count === 0) return record;
    } catch (err) { /* invalid storage counts as no history */ }
    return null;
  }

  var count;
  try {
    var last = readRecord(localStorage.getItem(key));
    var lastDay = last ? dayNumber(last.day) : -Infinity;
    if (lastDay > today) return; // a stale page must not overwrite newer history
    count = last && today - lastDay <= 1 ? last.count : 0;
    // Keep the first completed result for each date, even if the board is
    // replayed after a session reset. Pending boards never change history.
    if (result !== 'pending' && today > lastDay) {
      count = result === 'won' ? Math.min(count + 1, Number.MAX_SAFE_INTEGER) : 0;
      localStorage.setItem(key, JSON.stringify({ day: day, result: result, count: count }));
    }
  } catch (err) {
    return; // the game still works without browser storage
  }

  countElement.textContent = String(count);
  section.hidden = false;
})();
