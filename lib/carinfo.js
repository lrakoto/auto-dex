// External facts about a catalog car: Wikipedia summary, Wikidata facts and
// FuelEconomy.gov specs. (Country of origin is static — config/carquery.js.) Shared by the detail
// and compare pages. Every lookup is cached (lib/cache.js) and non-critical —
// failures resolve to null rather than throwing.
const cache = require('./cache');
const { cachedGet } = cache;
const wikimedia = require('./wikimedia');

const WIKI_HEADERS = { 'User-Agent': 'AutoDex/1.0 (https://github.com/lrakoto/auto-dex)' };

async function wikiByTitle(title) {
  try {
    const data = await cache.cachedGet(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
      { timeout: 4000, headers: WIKI_HEADERS }
    );
    if (data.type === 'standard' && data.extract) return data;
  } catch (e) { /* not found / offline */ }
  return null;
}

// Returns { summary, url, wikidataId } or null
async function getWikiSummary(make, model) {
  // Known article aliases need the same exact vehicle validation as photos.
  // A bare "MG3" lookup describes a machine gun, so a failed vehicle lookup
  // must stay empty rather than falling through to the generic title guesses.
  if (wikimedia.PHOTO_ALIASES.some(alias => alias.make === make && alias.model === model)) {
    try {
      const article = await wikimedia.findArticle(make, model);
      if (!article || !article.extract) return null;
      return {
        summary: article.extract,
        url: article.content_urls?.desktop?.page || null,
        wikidataId: article.wikibase_item || null
      };
    } catch (e) { return null; }
  }
  let hit = null;
  // 1. Direct title guesses
  for (const title of [`${make} ${model}`, model, `${make} ${model.split(' ')[0]}`]) {
    hit = await wikiByTitle(title);
    if (hit) break;
  }
  // 2. Fall back to Wikipedia search
  if (!hit) {
    try {
      const searchData = await cache.cachedGet('https://en.wikipedia.org/w/api.php', {
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
  Q174789: 'mm', Q174728: 'cm', Q11573: 'm', Q11570: 'kg', Q180154: 'km/h', Q211256: 'mph',
  Q218593: 'in', Q3710: 'ft'
};
// Length units → millimetres, for the compare page's size drawing (R11)
const LENGTH_TO_MM = { Q174789: 1, Q174728: 10, Q11573: 1000, Q218593: 25.4, Q3710: 304.8 };
const DIMENSION_LABELS = ['Length', 'Width', 'Height'];
// Anything outside this is a data-entry slip (a length in metres tagged as
// mm), not a road vehicle
const MIN_DIMENSION_MM = 300;
const MAX_DIMENSION_MM = 30000;

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

// A length quantity in millimetres, or null for other units and implausible values
function quantityMm(v) {
  const amount = Math.abs(parseFloat(v.amount));
  const factor = LENGTH_TO_MM[(v.unit || '').split('/').pop()];
  if (!Number.isFinite(amount) || !factor) return null;
  const mm = Math.round(amount * factor);
  return mm >= MIN_DIMENSION_MM && mm <= MAX_DIMENSION_MM ? mm : null;
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
    if (!text) continue;
    const fact = { label: f.label, values: [text] };
    // Length, width and height also carry millimetres for the size drawing
    if (DIMENSION_LABELS.includes(f.label)) {
      const mm = quantityMm(v);
      if (mm) fact.mm = mm;
    }
    facts.push(fact);
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

// Raw P1092 (units built) as a number, for callers that score against it
// (R7 rarity) rather than display it. Shares getWikidataFacts's cache entry
// (lib/cache.js keys by URL), so calling both for the same qid on one page
// costs a single request.
async function getUnitsBuilt(qid) {
  if (!/^Q\d+$/.test(qid || '')) return null;
  try {
    const data = await cachedGet(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
      timeout: 5000, headers: WIKI_HEADERS
    });
    const entity = data.entities && data.entities[qid];
    const v = entity && claimValues(entity.claims || {}, 'P1092')[0];
    const amount = v && parseFloat(v.amount);
    return Number.isFinite(amount) ? Math.round(Math.abs(amount)) : null;
  } catch (e) {
    return null;
  }
}

// ─── FuelEconomy.gov specs ───────────────────────────────────────────────────

// The API mixes numeric strings, zero values and unavailable (-1) sentinels.
// Savings are signed; costs/emissions cannot be negative and scores are 1–10.
function fuelNumber(value, min = -Infinity, max = Infinity, whole = false) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max && (!whole || Number.isInteger(n)) ? n : null;
}

// Probes up to 9 model years in parallel, newest first, ending at latestYear
// (the car's last known model year, so discontinued cars still get specs).
// FuelEconomy.gov often names a model with its drivetrain or trim attached
// ("Outback AWD", "Telluride FWD", "CX-5 4WD", "Camry HEV FF LE"), so the
// exact name finds nothing for many current cars. Its model menu for a year
// and make is the fallback: a name whose words start with all of ours
// (hyphens ignored: "F150 Pickup 2WD" for F-150, but never "CX-50 4WD" for
// CX-5), fewest extra words first.
const fuelWords = s => String(s).toLowerCase().replace(/-/g, '').split(/\s+/).filter(Boolean);

function fuelVariant(menuNames, model) {
  const want = fuelWords(model);
  const fits = menuNames
    .map(name => ({ name, words: fuelWords(name) }))
    .filter(v => v.words.length > want.length && want.every((w, i) => v.words[i] === w))
    .sort((a, b) => a.words.length - b.words.length || a.name.localeCompare(b.name));
  return fits.length ? fits[0].name : null;
}

const menuItems = data => {
  const items = data && data.menuItem;
  return items ? (Array.isArray(items) ? items : [items]) : [];
};

async function getFuelSpecs(make, model, latestYear) {
  try {
    const headers = { Accept: 'application/json' };
    const newest = Math.min(latestYear || Infinity, new Date().getFullYear());
    const years = [];
    for (let y = newest; y >= newest - 8 && y >= 1984; y--) years.push(y);
    const options = (year, name) => cachedGet('https://www.fueleconomy.gov/ws/rest/vehicle/menu/options', {
      params: { year, make, model: name }, headers, timeout: 4000
    });

    const probes = await Promise.allSettled(years.map(year => options(year, model)));
    // FuelEconomy.gov answers a name it doesn't know with a JSON null
    const hit = probes.find(r => r.status === 'fulfilled' && r.value && r.value.menuItem);
    let items = hit ? menuItems(hit.value) : [];
    // No exact name: a drivetrain/trim variant from the newest year that has
    // one (the menus are fetched together, like the probes above)
    if (!hit) {
      const menus = await Promise.allSettled(years.map(year =>
        cachedGet('https://www.fueleconomy.gov/ws/rest/vehicle/menu/model', { params: { year, make }, headers, timeout: 4000 })
      ));
      for (const [i, menu] of menus.entries()) {
        if (menu.status !== 'fulfilled') continue;
        const variant = fuelVariant(menuItems(menu.value).map(item => item.value), model);
        if (!variant) continue;
        items = menuItems(await options(years[i], variant).catch(() => null));
        if (items.length) break;
      }
    }
    if (!items.length) return null;
    const vehicleId = items[0].value;
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
      combMpg:      d.comb08,
      annualFuelCost:  fuelNumber(d.fuelCost08, 0),
      fiveYearSavings: fuelNumber(d.youSaveSpend),
      co2:          fuelNumber(d.co2TailpipeGpm, 0),
      feScore:      fuelNumber(d.feScore, 1, 10, true),
      ghgScore:     fuelNumber(d.ghgScore, 1, 10, true)
    };
  } catch (e) {
    return null;
  }
}

// Ascending model years → production runs: [1981..1998, 2020..2027] →
// [[1981, 1998], [2020, 2027]]. Single-year gaps are bridged — NHTSA's
// per-year lists occasionally drop a model for one year.
function yearRuns(years) {
  const runs = [];
  for (const y of years || []) {
    const last = runs[runs.length - 1];
    if (last && y - last[1] <= 2) last[1] = y;
    else runs.push([y, y]);
  }
  return runs;
}

// A car's runs as text: "1981–1998, 2020–2027"
function formatYears(car) {
  if (!car) return null;
  const years = car.model_years && car.model_years.length
    ? car.model_years
    : (car.year_min ? [car.year_min, car.year_max] : null);
  if (!years) return null;
  return yearRuns(years).map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

module.exports = { getWikiSummary, getWikidataFacts, getUnitsBuilt, extractFacts, getFuelSpecs, fuelVariant, yearRuns, formatYears };
