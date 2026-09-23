// External facts about a catalog car: Wikipedia summary, Wikidata facts,
// manufacturer country (NHTSA) and FuelEconomy.gov specs. Shared by the detail
// and compare pages. Every lookup is cached (lib/cache.js) and non-critical —
// failures resolve to null rather than throwing.
const { cachedGet } = require('./cache');

const WIKI_HEADERS = { 'User-Agent': 'AutoDex/1.0 (https://github.com/lrakoto/auto-dex)' };

async function wikiByTitle(title) {
  try {
    const data = await cachedGet(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
      { timeout: 4000, headers: WIKI_HEADERS }
    );
    if (data.type === 'standard' && data.extract) return data;
  } catch (e) { /* not found / offline */ }
  return null;
}

// Returns { summary, url, wikidataId } or null
async function getWikiSummary(make, model) {
  let hit = null;
  // 1. Direct title guesses
  for (const title of [`${make} ${model}`, model, `${make} ${model.split(' ')[0]}`]) {
    hit = await wikiByTitle(title);
    if (hit) break;
  }
  // 2. Fall back to Wikipedia search
  if (!hit) {
    try {
      const searchData = await cachedGet('https://en.wikipedia.org/w/api.php', {
        params: { action: 'opensearch', search: `${make} ${model} automobile`, limit: 3, format: 'json' },
        timeout: 4000,
        headers: WIKI_HEADERS
      });
      for (const title of searchData[1] || []) {
        hit = await wikiByTitle(title);
        if (hit) break;
      }
    } catch (e) { /* non-critical */ }
  }
  if (!hit) return null;
  return {
    summary: hit.extract,
    url: hit.content_urls?.desktop?.page || null,
    wikidataId: hit.wikibase_item || null
  };
}

// ─── Wikidata ────────────────────────────────────────────────────────────────
// Coverage for car models is patchy, so every fact is optional and the page
// shows only what exists.

const ITEM_FACTS = [
  { prop: 'P279', label: 'Class', max: 2 },
  { prop: 'P516', label: 'Engine', max: 3 },
  { prop: 'P287', label: 'Designer', max: 2 },
  { prop: 'P1071', label: 'Assembly', max: 3 },
  { prop: 'P495', label: 'Origin', max: 1 },
  { prop: 'P155', label: 'Preceded by', max: 1, link: true },
  { prop: 'P156', label: 'Succeeded by', max: 1, link: true }
];

// Quantity props and the units we know how to print
const QUANTITY_FACTS = [
  { prop: 'P2052', label: 'Top speed' },
  { prop: 'P2067', label: 'Weight' },
  { prop: 'P2043', label: 'Length' },
  { prop: 'P2049', label: 'Width' },
  { prop: 'P2048', label: 'Height' },
  { prop: 'P1092', label: 'Units built' }
];
const UNITS = {
  Q174789: 'mm', Q174728: 'cm', Q11573: 'm', Q11570: 'kg', Q180154: 'km/h', Q211256: 'mph'
};

function claimValues(claims, prop) {
  return (claims[prop] || [])
    .filter(c => c.rank !== 'deprecated')
    .map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value)
    .filter(Boolean);
}

function formatQuantity(v) {
  const amount = Math.abs(parseFloat(v.amount));
  if (!Number.isFinite(amount)) return null;
  const unitId = (v.unit || '').split('/').pop();
  if (unitId === '1' || v.unit === '1') return amount.toLocaleString('en-US');
  const unit = UNITS[unitId];
  return unit ? `${amount.toLocaleString('en-US')} ${unit}` : null;
}

function yearOf(timeValue) {
  const m = timeValue && /^[+-]?(\d{4})/.exec(timeValue.time || '');
  return m ? parseInt(m[1], 10) : null;
}

// Pure: turn an entity + a label lookup into display facts. Exported for tests.
function extractFacts(entity, labels) {
  const claims = (entity && entity.claims) || {};
  const facts = [];
  for (const f of ITEM_FACTS) {
    const names = claimValues(claims, f.prop)
      .map(v => labels[v.id])
      .filter(Boolean)
      .slice(0, f.max);
    if (names.length) facts.push({ label: f.label, values: names, link: !!f.link });
  }
  const from = yearOf(claimValues(claims, 'P571')[0]);
  const to = yearOf(claimValues(claims, 'P2669')[0] || claimValues(claims, 'P576')[0]);
  if (from) facts.push({ label: 'Produced', values: [to ? `${from}–${to}` : `${from}–`] });
  for (const f of QUANTITY_FACTS) {
    const v = claimValues(claims, f.prop)[0];
    const text = v && formatQuantity(v);
    if (text) facts.push({ label: f.label, values: [text] });
  }
  return facts;
}

async function getWikidataFacts(qid) {
  if (!/^Q\d+$/.test(qid || '')) return [];
  try {
    const data = await cachedGet(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
      timeout: 5000, headers: WIKI_HEADERS
    });
    const entity = data.entities && data.entities[qid];
    if (!entity) return [];

    // Resolve every referenced item's English label in one request
    const ids = new Set();
    for (const f of ITEM_FACTS) {
      claimValues(entity.claims || {}, f.prop).slice(0, f.max).forEach(v => v.id && ids.add(v.id));
    }
    const labels = {};
    if (ids.size) {
      const lab = await cachedGet('https://www.wikidata.org/w/api.php', {
        params: { action: 'wbgetentities', ids: [...ids].join('|'), props: 'labels', languages: 'en', format: 'json' },
        timeout: 5000,
        headers: WIKI_HEADERS
      });
      for (const [id, e] of Object.entries(lab.entities || {})) {
        if (e.labels && e.labels.en) labels[id] = e.labels.en.value;
      }
    }
    return extractFacts(entity, labels);
  } catch (e) {
    return [];
  }
}

// ─── NHTSA manufacturer country ──────────────────────────────────────────────

async function getCountry(make) {
  try {
    const mfrList = await cachedGet('https://vpic.nhtsa.dot.gov/api/vehicles/getallmanufacturers?format=json');
    if (mfrList && Array.isArray(mfrList.Results)) {
      const mfr = mfrList.Results.find(m =>
        m.Mfr_CommonName && m.Mfr_CommonName.toLowerCase() === make.toLowerCase()
      );
      if (mfr) return mfr.Country;
    }
  } catch (e) { /* non-critical */ }
  return null;
}

// ─── FuelEconomy.gov specs ───────────────────────────────────────────────────

// Probes up to 9 model years in parallel, newest first, ending at latestYear
// (the car's last known model year, so discontinued cars still get specs).
async function getFuelSpecs(make, model, latestYear) {
  try {
    const headers = { Accept: 'application/json' };
    const newest = Math.min(latestYear || Infinity, new Date().getFullYear());
    const years = [];
    for (let y = newest; y >= newest - 8 && y >= 1984; y--) years.push(y);

    const probes = await Promise.allSettled(years.map(year =>
      cachedGet('https://www.fueleconomy.gov/ws/rest/vehicle/menu/options', {
        params: { year, make, model }, headers, timeout: 4000
      })
    ));
    const hit = probes.find(r => r.status === 'fulfilled' && r.value.menuItem);
    if (!hit) return null;
    const items = hit.value.menuItem;
    const vehicleId = (Array.isArray(items) ? items[0] : items).value;
    const d = await cachedGet(`https://www.fueleconomy.gov/ws/rest/vehicle/${vehicleId}`, { headers, timeout: 4000 });
    return {
      year:         d.year,
      type:         d.VClass,
      cylinders:    d.cylinders,
      displacement: d.displ,
      transmission: d.trany,
      drive:        d.drive,
      fuel:         d.fuelType1 || d.fuelType,
      cityMpg:      d.city08,
      hwyMpg:       d.highway08,
      combMpg:      d.comb08
    };
  } catch (e) {
    return null;
  }
}

// [1981..1998, 2020..2027] → "1981–1998, 2020–2027". Single-year gaps are
// bridged — NHTSA's per-year lists occasionally drop a model for one year.
function formatYears(car) {
  if (!car) return null;
  const years = car.model_years && car.model_years.length
    ? car.model_years
    : (car.year_min ? [car.year_min, car.year_max] : null);
  if (!years) return null;
  const runs = [];
  for (const y of years) {
    const last = runs[runs.length - 1];
    if (last && y - last[1] <= 2) last[1] = y;
    else runs.push([y, y]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

module.exports = { getWikiSummary, getWikidataFacts, extractFacts, getCountry, getFuelSpecs, formatYears };
