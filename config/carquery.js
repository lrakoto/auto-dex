/**
 * International makes list + NHTSA model lookup.
 * CarQuery blocked server-side requests, so we use a curated static makes list
 * and NHTSA's getmodelsformake endpoint (which covers international brands).
 */
const axios = require('axios');

const MAKES_LIST = [
  'Acura','Alfa Romeo','Aston Martin','Audi','Bentley','BMW','Bugatti','Buick',
  'Cadillac','Chevrolet','Chrysler','Citroën','Cupra',
  'Dacia','Daewoo','Daihatsu','Dodge','Ferrari','Fiat','Ford',
  'Genesis','GMC','Honda','Hummer','Hyundai',
  'Infiniti','Isuzu','Jaguar','Jeep','Kia',
  'Lamborghini','Lancia','Land Rover','Lexus','Lincoln','Lotus','Lucid',
  'Maserati','Mazda','McLaren','Mercedes-Benz','Mercury','MG','MINI','Mitsubishi',
  'Nissan','Oldsmobile','Opel','Pagani','Peugeot',
  'Plymouth','Polestar','Pontiac','Porsche',
  'Ram','Renault','Rivian','Rolls-Royce',
  'Saab','Saturn','Scion','SEAT','Škoda','Smart','Subaru','Suzuki',
  'Tesla','Toyota','Vauxhall','Volkswagen','Volvo',
].sort((a, b) => a.localeCompare(b));

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const modelsCache = {};

// Compare make names across sources that disagree on case, accents and
// punctuation (NHTSA says "SKODA", "MERCEDES-BENZ", "ROLLS ROYCE").
function normalizeMake(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

// Map any spelling of a make onto our MAKES_LIST spelling, or null.
function canonicalMake(name) {
  const wanted = normalizeMake(name);
  if (!wanted) return null;
  return MAKES_LIST.find(m => normalizeMake(m) === wanted) || null;
}

async function getMakes() {
  return MAKES_LIST.map(display => ({ display, id: display.toLowerCase(), country: '' }));
}

async function getModels(makeDisplay) {
  const now = Date.now();
  const cached = modelsCache[makeDisplay];
  if (cached && (now - cached.at) < CACHE_TTL) return cached.data;

  try {
    const res = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformake/${encodeURIComponent(makeDisplay)}?format=json`,
      { timeout: 8000 }
    );
    // NHTSA matches the make as a substring, so asking for "MG" also returns
    // models from CHEMGUARD, MGM Trailers, TMG Trailer and friends. Keep only
    // exact make matches, and store our own spelling so casing stays stable
    // ("SAAB"/"smart" come back inconsistently).
    const wanted = makeDisplay.trim().toLowerCase();
    const seen = new Set();
    const models = (res.data.Results || [])
      .filter(m => (m.Make_Name || '').trim().toLowerCase() === wanted)
      .filter(m => { if (seen.has(m.Model_Name)) return false; seen.add(m.Model_Name); return true; })
      .map(m => ({ make: makeDisplay, model: m.Model_Name }))
      .sort((a, b) => a.model.localeCompare(b.model));
    modelsCache[makeDisplay] = { data: models, at: now };
    return models;
  } catch (err) {
    console.log(`getModels error for ${makeDisplay}:`, err.message);
    return [];
  }
}

module.exports = { MAKES_LIST, getMakes, getModels, normalizeMake, canonicalMake };
