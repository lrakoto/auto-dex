// NHTSA lookups beyond the make/model list in config/carquery.js:
// model-year ranges (vPIC), VIN decoding (vPIC) and recalls (api.nhtsa.gov).
// All free, no key.
const axios = require('axios');
const { cachedGet } = require('./cache');
const { normalizeMake, canonicalMake } = require('../config/carquery');

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
const FIRST_YEAR = 1981; // 17-character VINs (and useful vPIC data) start here

// 17 chars, no I/O/Q — the letters VINs never use
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

function normalizeVin(vin) {
  const v = String(vin || '').trim().toUpperCase();
  return VIN_RE.test(v) ? v : null;
}

// Scan every model year for a make and return { model -> [years ascending] }.
// One request per year, spaced by delayMs so we stay polite to NHTSA.
// Reject an incomplete scan so callers never replace known years with a
// partial answer or mark a failed make complete. Empty Results is valid.
async function getModelYears(make, { fromYear = FIRST_YEAR, toYear = new Date().getFullYear() + 1, delayMs = 250 } = {}) {
  const wanted = normalizeMake(make);
  const ranges = new Map();
  for (let year = fromYear; year <= toYear; year++) {
    try {
      const res = await axios.get(
        `${VPIC}GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`,
        { timeout: 8000 }
      );
      if (!res.data || !Array.isArray(res.data.Results)) throw new Error('Invalid model-year response');
      // Same substring problem as getmodelsformake — keep exact make matches only
      for (const r of res.data.Results) {
        if (normalizeMake(r.Make_Name) !== wanted) continue;
        if (typeof r.Model_Name !== 'string' || !r.Model_Name.trim()) throw new Error('Invalid model name');
        const years = ranges.get(r.Model_Name);
        if (!years) ranges.set(r.Model_Name, [year]);
        else if (years[years.length - 1] !== year) years.push(year); // years ascend; skip dupes
      }
    } catch (err) {
      throw new Error(`Incomplete model-year scan for ${make} (${year}): ${err.message}`, { cause: err });
    }
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  return ranges;
}

// Decode a VIN into the fields the add-car form needs. Returns null when NHTSA
// can't identify the vehicle.
async function decodeVin(vin) {
  const v = normalizeVin(vin);
  if (!v) return null;
  const data = await cachedGet(`${VPIC}DecodeVinValues/${v}`, { params: { format: 'json' }, timeout: 8000 });
  const r = (data.Results || [])[0];
  if (!r || !r.Make || !r.Model || !r.ModelYear) return null;
  const displacement = parseFloat(r.DisplacementL);
  return {
    vin: v,
    make: canonicalMake(r.Make) || r.Make,
    knownMake: !!canonicalMake(r.Make),
    model: r.Model,
    year: r.ModelYear,
    trim: r.Trim || null,
    bodyClass: r.BodyClass || null,
    engine: Number.isFinite(displacement)
      ? `${displacement.toFixed(1)}L${r.EngineCylinders ? ' ' + r.EngineCylinders + '-cyl' : ''}`
      : null,
    fuel: r.FuelTypePrimary || null
  };
}

// Open recalls for a make/model/year. Cached 12h; throws on network failure so
// callers can tell "no recalls" from "couldn't check".
async function getRecalls(make, model, year) {
  const data = await cachedGet('https://api.nhtsa.gov/recalls/recallsByVehicle', {
    params: { make, model, modelYear: year },
    ttl: 12 * 60 * 60 * 1000,
    timeout: 6000
  });
  return (data.results || []).map(r => ({
    campaign: r.NHTSACampaignNumber,
    date: r.ReportReceivedDate,
    component: r.Component,
    summary: r.Summary,
    consequence: r.Consequence,
    remedy: r.Remedy,
    parkIt: !!r.parkIt
  }));
}

// 5-star ratings for a make/model/year: overall, frontal, side, rollover.
// Two-step API — list the trims NHTSA tested for that model year, then pull
// ratings for the first one. Cached long since published ratings don't change.
async function getSafetyRatings(make, model, year) {
  if (!year) return null;
  const ttl = 30 * 24 * 60 * 60 * 1000;
  const list = await cachedGet(
    `https://api.nhtsa.gov/SafetyRatings/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`,
    { ttl, timeout: 6000 }
  );
  const vehicleId = list.Results && list.Results[0] && list.Results[0].VehicleId;
  if (!vehicleId) return null;
  const data = await cachedGet(`https://api.nhtsa.gov/SafetyRatings/VehicleId/${vehicleId}`, { ttl, timeout: 6000 });
  const r = data.Results && data.Results[0];
  if (!r) return null;
  // NHTSA returns "Not Rated" (or omits the field) when a category wasn't tested
  const star = v => (v && /^[1-5]$/.test(String(v).trim())) ? Number(v) : null;
  const ratings = {
    overall: star(r.OverallRating),
    frontal: star(r.OverallFrontCrashRating),
    side: star(r.OverallSideCrashRating),
    rollover: star(r.RolloverRating)
  };
  return Object.values(ratings).some(v => v !== null) ? ratings : null;
}

// Owner complaints for a make/model/year, summarized as a total count and the
// most-cited components (e.g. { component: 'STEERING', count: 444 }). A
// complaint's `components` field lists one or more components, each a colon-
// separated hierarchy ("SUSPENSION:FRONT:CONTROL ARM"); we group by the
// top-level category. Cached 24h — new complaints trickle in daily, unlike
// the published-once safety ratings. Returns null when no model year is
// known (catalog cars have no single year).
//
// The car pages ask with the car's latest model year, usually one that has
// barely started ("No owner complaints … for the 2027 model year" on every
// current car), so the newest of the last three model years that has any
// complaints is shown instead, with its year; with none in all three, the
// latest year's empty count. A year whose request fails doesn't hide another.
const COMPLAINTS_LOOKBACK_YEARS = 2;

async function getComplaints(make, model, year) {
  const latest = parseInt(year, 10);
  if (!latest) return null;
  const years = [];
  for (let y = latest; y >= latest - COMPLAINTS_LOOKBACK_YEARS; y--) years.push(y);
  const results = await Promise.allSettled(years.map(y => complaintsForYear(make, model, y)));
  const i = results.findIndex(r => r.status === 'fulfilled' && r.value.count > 0);
  if (i >= 0) return { ...results[i].value, year: years[i] };
  const answered = results.findIndex(r => r.status === 'fulfilled');
  if (answered < 0) throw results[0].reason;
  return { ...results[answered].value, year: years[answered] };
}

const COMPLAINTS_TTL = 24 * 60 * 60 * 1000;
const MAX_COMPLAINT_NAMES = 8;
const complaintWords = s => String(s).toLowerCase().replace(/-/g, '').split(/\s+/).filter(Boolean);

// NHTSA files some complaints under body and trim names ("CIVIC SEDAN",
// "CIVIC HATCHBACK") and answers the ambiguous plain name with HTTP 400. Its
// list of complaint names per make and year is incomplete (no TELLURIDE or
// RAV4 in 2025), so the plain name is still asked first; only when it is
// ambiguous or has nothing are the listed names whose words start with all of
// the model's counted (never CX-50 for CX-5), complaints de-duplicated by
// number. The cache keeps 404s, not 400s, so an ambiguous name is remembered
// here for a day instead of being re-asked on every page view.
const ambiguousNames = new Map(); // "make|model|year" -> remembered until
const AMBIGUOUS_MAX = 1000;

async function complaintsNamed(make, name, year) {
  return cachedGet('https://api.nhtsa.gov/complaints/complaintsByVehicle', {
    params: { make, model: name, modelYear: year },
    ttl: COMPLAINTS_TTL,
    timeout: 6000
  });
}

async function plainComplaints(make, model, year) {
  const key = `${make}|${model}|${year}`;
  if ((ambiguousNames.get(key) || 0) > Date.now()) return null;
  try {
    return await complaintsNamed(make, model, year);
  } catch (err) {
    if (!(err.response && err.response.status === 400)) throw err;
    if (ambiguousNames.size >= AMBIGUOUS_MAX) ambiguousNames.delete(ambiguousNames.keys().next().value);
    ambiguousNames.set(key, Date.now() + COMPLAINTS_TTL);
    return null;
  }
}

async function listedComplaintNames(make, model, year) {
  const data = await cachedGet('https://api.nhtsa.gov/products/vehicle/models', {
    params: { modelYear: year, make, issueType: 'c' },
    ttl: COMPLAINTS_TTL,
    timeout: 6000
  });
  const want = complaintWords(model);
  return [...new Set(((data && data.results) || []).map(r => r.model).filter(Boolean))]
    .filter(name => {
      const words = complaintWords(name);
      return words.length > want.length && want.every((w, i) => words[i] === w);
    })
    .slice(0, MAX_COMPLAINT_NAMES);
}

async function complaintsForYear(make, model, year) {
  const plain = await plainComplaints(make, model, year);
  let lists = plain ? [plain] : [];
  let countedAs = null;
  if (!plain || !(plain.results || []).length) {
    const names = await listedComplaintNames(make, model, year).catch(() => []);
    if (names.length) {
      lists = await Promise.all(names.map(name => complaintsNamed(make, name, year)));
      countedAs = names;
    }
  }
  const seen = new Set();
  const results = [];
  for (const data of lists) {
    for (const r of (data && data.results) || []) {
      if (r.odiNumber != null) {
        if (seen.has(r.odiNumber)) continue;
        seen.add(r.odiNumber);
      }
      results.push(r);
    }
  }
  const counts = new Map();
  for (const r of results) {
    for (const raw of String(r.components || '').split(',')) {
      const component = raw.split(':')[0].trim();
      if (!component) continue;
      counts.set(component, (counts.get(component) || 0) + 1);
    }
  }
  const topComponents = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([component, count]) => ({ component, count }));
  return { count: results.length, topComponents, countedAs };
}

module.exports = { getModelYears, decodeVin, getRecalls, getSafetyRatings, getComplaints, normalizeVin, FIRST_YEAR };
