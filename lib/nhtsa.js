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
// The car pages ask with the car's latest model year, which for a current car
// is usually next year's and not rated yet (2027 Camry, Telluride, CX-5 on
// 2026-10-29: nothing), so the box vanished from nearly every current model.
// Walk back up to SAFETY_LOOKBACK_YEARS and return the newest rated year,
// with that year in the result so pages can say which one they show.
const SAFETY_LOOKBACK_YEARS = 2;

async function getSafetyRatings(make, model, year) {
  const latest = parseInt(year, 10);
  if (!latest) return null;
  const years = [];
  for (let y = latest; y >= latest - SAFETY_LOOKBACK_YEARS; y--) years.push(y);
  // The years together (each answer cached 30 days); the newest rated wins. A
  // year that fails doesn't hide one that answered; only a total outage throws.
  const results = await Promise.allSettled(years.map(y => safetyRatingsForYear(make, model, y)));
  const i = results.findIndex(r => r.status === 'fulfilled' && r.value);
  if (i >= 0) return { ...results[i].value, year: years[i] };
  if (results.every(r => r.status === 'rejected')) throw results[0].reason;
  return null;
}

const SAFETY_TTL = 30 * 24 * 60 * 60 * 1000;
const SAFETY_API = 'https://api.nhtsa.gov/SafetyRatings';

async function safetyVehicleId(make, model, year) {
  const list = await cachedGet(
    `${SAFETY_API}/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`,
    { ttl: SAFETY_TTL, timeout: 6000 }
  );
  return (list.Results && list.Results[0] && list.Results[0].VehicleId) || null;
}

// NHTSA rates many models under a body or powertrain name ("CAMRY HYBRID",
// "ACCORD SEDAN", "CIVIC SEDAN"), with nothing under the plain name. Of the
// year's rated names, take one whose words start with all of the model's
// (case and hyphens ignored; never "CX-50" for CX-5): fewest extra words,
// then not a powertrain variant (the Accord sedan, not the hybrid), then
// alphabetical.
const POWERTRAIN_WORDS = new Set(['hybrid', 'phev', 'ev', 'fcev', 'electric', 'plugin']);
const safetyWords = s => String(s).toLowerCase().replace(/-/g, '').split(/\s+/).filter(Boolean);

function safetyVariant(names, model) {
  const want = safetyWords(model);
  const fits = names
    .map(name => ({ name, words: safetyWords(name) }))
    .filter(v => v.words.length > want.length && want.every((w, i) => v.words[i] === w))
    .map(v => ({ ...v, powertrain: v.words.slice(want.length).some(w => POWERTRAIN_WORDS.has(w)) }))
    .sort((a, b) => a.words.length - b.words.length || a.powertrain - b.powertrain || a.name.localeCompare(b.name));
  return fits.length ? fits[0].name : null;
}

async function safetyRatingsForYear(make, model, year) {
  let ratedAs = null;
  let vehicleId = await safetyVehicleId(make, model, year);
  if (!vehicleId) {
    const rated = await cachedGet(
      `${SAFETY_API}/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}`,
      { ttl: SAFETY_TTL, timeout: 6000 }
    );
    ratedAs = safetyVariant(((rated && rated.Results) || []).map(r => r.Model).filter(Boolean), model);
    if (!ratedAs) return null;
    vehicleId = await safetyVehicleId(make, ratedAs, year);
    if (!vehicleId) return null;
  }
  const ttl = SAFETY_TTL;
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
  return Object.values(ratings).some(v => v !== null) ? { ...ratings, ratedAs } : null;
}

// Owner complaints for a make/model/year, summarized as a total count and the
// most-cited components (e.g. { component: 'STEERING', count: 444 }). A
// complaint's `components` field lists one or more components, each a colon-
// separated hierarchy ("SUSPENSION:FRONT:CONTROL ARM"); we group by the
// top-level category. Cached 24h — new complaints trickle in daily, unlike
// the published-once safety ratings. Returns null when no model year is
// known (catalog cars have no single year).
async function getComplaints(make, model, year) {
  if (!year) return null;
  const data = await cachedGet('https://api.nhtsa.gov/complaints/complaintsByVehicle', {
    params: { make, model, modelYear: year },
    ttl: 24 * 60 * 60 * 1000,
    timeout: 6000
  });
  const results = data.results || [];
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
  return { count: results.length, topComponents };
}

module.exports = { getModelYears, decodeVin, getRecalls, getSafetyRatings, safetyVariant, getComplaints, normalizeVin, FIRST_YEAR };
