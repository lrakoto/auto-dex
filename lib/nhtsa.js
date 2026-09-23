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

module.exports = { getModelYears, decodeVin, getRecalls, normalizeVin, FIRST_YEAR };
