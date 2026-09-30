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
async function getModelYears(make, { fromYear = FIRST_YEAR, toYear = new Date().getFullYear() + 1, delayMs = 250 } = {}) {
  const wanted = normalizeMake(make);
  const ranges = new Map();
  for (let year = fromYear; year <= toYear; year++) {
    try {
      const res = await axios.get(
        `${VPIC}GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`,
        { timeout: 8000 }
      );
      // Same substring problem as getmodelsformake — keep exact make matches only
      for (const r of res.data.Results || []) {
        if (normalizeMake(r.Make_Name) !== wanted) continue;
        const years = ranges.get(r.Model_Name);
        if (!years) ranges.set(r.Model_Name, [year]);
        else if (years[years.length - 1] !== year) years.push(year); // years ascend; skip dupes
      }
    } catch (err) {
      console.log(`Years: ${make} ${year} failed:`, err.message);
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

module.exports = { getModelYears, decodeVin, getRecalls, getSafetyRatings, getComplaints, normalizeVin, FIRST_YEAR };
