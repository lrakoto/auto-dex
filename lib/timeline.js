// Production timeline for one make: a row per model with its runs of model
// years (from jobs/years.js), laid out on a shared year axis. Pure — the
// route loads the rows, the view only positions what this returns.
const { yearRuns } = require('./carinfo');

const TICK_EVERY = 5;

// Percent offset/width of [from, to] on the axis [start, end] (inclusive
// years, so a single year still has width)
function place(from, to, start, span) {
  return {
    left: ((from - start) / span) * 100,
    width: ((to - from + 1) / span) * 100
  };
}

// Where a row's hover label fits without covering a bar or the model name:
// after the last bar, else before the first, else in the widest production
// gap (the Supra's 1998–2020 hiatus), else as a chip over the bar's end.
const LABEL_ROOM = 28; // percent of the track the label text needs
function labelPlacement(segments) {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const end = last.left + last.width;
  if (end <= 100 - LABEL_ROOM) return { side: 'left', pct: end };
  if (first.left >= LABEL_ROOM) return { side: 'right', pct: 100 - first.left };
  let gap = null;
  for (let i = 1; i < segments.length; i++) {
    const from = segments[i - 1].left + segments[i - 1].width;
    const width = segments[i].left - from;
    if (width >= LABEL_ROOM && (!gap || width > gap.width)) gap = { from, width };
  }
  if (gap) return { side: 'left', pct: gap.from };
  return { side: 'right', pct: 0, onBar: true };
}

function buildTimeline(cars, { now = new Date().getFullYear() } = {}) {
  const rows = cars
    .filter(c => c.model_years && c.model_years.length)
    .map(c => {
      const runs = yearRuns(c.model_years);
      return { make: c.make, model: c.model, runs, first: runs[0][0], last: runs[runs.length - 1][1] };
    })
    .sort((a, b) => a.first - b.first || a.last - b.last || a.model.localeCompare(b.model));
  if (rows.length === 0) return null;

  const start = Math.min(...rows.map(r => r.first));
  const end = Math.max(now, ...rows.map(r => r.last));
  const span = end - start + 1;

  for (const r of rows) {
    // NHTSA lists next year's models early, so "on sale" means a run that
    // reaches this year
    r.current = r.last >= now;
    r.segments = r.runs.map(([from, to]) => ({
      from, to,
      label: from === to ? String(from) : `${from}–${to}`,
      current: to >= now,
      ...place(from, to, start, span)
    }));
    r.label = r.segments.map(s => s.label).join(', ');
    r.labelAt = labelPlacement(r.segments);
  }

  const ticks = [];
  for (let y = Math.ceil(start / TICK_EVERY) * TICK_EVERY; y <= end; y += TICK_EVERY) {
    ticks.push({ year: y, left: ((y - start) / span) * 100, major: y % 10 === 0 });
  }

  return {
    rows,
    start,
    end,
    ticks,
    // Centre of the current year's column
    nowLeft: ((now - start + 0.5) / span) * 100,
    currentCount: rows.filter(r => r.current).length
  };
}

module.exports = { buildTimeline };
