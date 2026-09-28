/**
 * International makes list + NHTSA model lookup.
 * CarQuery blocked server-side requests, so we use curated static make lists
 * and NHTSA's model lists (which cover international brands), by vehicle type.
 */
const { cachedGet } = require('../lib/cache');

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

// Makes known here only for their motorcycles. Car makes that also build them
// (Honda, Suzuki, BMW) stay in MAKES_LIST; each catalog row's vehicle_type
// says which is which (lib/vehicleTypes.js).
const MOTORCYCLE_MAKES = [
  'Aprilia', 'Ducati', 'Harley-Davidson', 'Indian', 'Kawasaki', 'KTM',
  'Moto Guzzi', 'MV Agusta', 'Royal Enfield', 'Triumph', 'Yamaha', 'Zero'
].sort((a, b) => a.localeCompare(b));

const ALL_MAKES = [...MAKES_LIST, ...MOTORCYCLE_MAKES].sort((a, b) => a.localeCompare(b));

// NHTSA's name for a make, where it isn't ours
const NHTSA_MAKE_ALIASES = {
  'Indian': ['Indian Motorcycle'],
  'MV Agusta': ['MV Agusta Motor'],
  'Zero': ['Zero Motorcycles']
};

// Country of origin per make. Static because NHTSA's manufacturer list names
// whichever legal entity files with it — Toyota came back as the US subsidiary.
const MAKE_COUNTRIES = {
  'Acura': 'Japan', 'Alfa Romeo': 'Italy', 'Aston Martin': 'United Kingdom', 'Audi': 'Germany',
  'Bentley': 'United Kingdom', 'BMW': 'Germany', 'Bugatti': 'France', 'Buick': 'United States',
  'Cadillac': 'United States', 'Chevrolet': 'United States', 'Chrysler': 'United States',
  'Citroën': 'France', 'Cupra': 'Spain', 'Dacia': 'Romania', 'Daewoo': 'South Korea',
  'Daihatsu': 'Japan', 'Dodge': 'United States', 'Ferrari': 'Italy', 'Fiat': 'Italy',
  'Ford': 'United States', 'Genesis': 'South Korea', 'GMC': 'United States', 'Honda': 'Japan',
  'Hummer': 'United States', 'Hyundai': 'South Korea', 'Infiniti': 'Japan', 'Isuzu': 'Japan',
  'Jaguar': 'United Kingdom', 'Jeep': 'United States', 'Kia': 'South Korea',
  'Lamborghini': 'Italy', 'Lancia': 'Italy', 'Land Rover': 'United Kingdom', 'Lexus': 'Japan',
  'Lincoln': 'United States', 'Lotus': 'United Kingdom', 'Lucid': 'United States',
  'Maserati': 'Italy', 'Mazda': 'Japan', 'McLaren': 'United Kingdom', 'Mercedes-Benz': 'Germany',
  'Mercury': 'United States', 'MG': 'United Kingdom', 'MINI': 'United Kingdom',
  'Mitsubishi': 'Japan', 'Nissan': 'Japan', 'Oldsmobile': 'United States', 'Opel': 'Germany',
  'Pagani': 'Italy', 'Peugeot': 'France', 'Plymouth': 'United States', 'Polestar': 'Sweden',
  'Pontiac': 'United States', 'Porsche': 'Germany', 'Ram': 'United States', 'Renault': 'France',
  'Rivian': 'United States', 'Rolls-Royce': 'United Kingdom', 'Saab': 'Sweden',
  'Saturn': 'United States', 'Scion': 'Japan', 'SEAT': 'Spain', 'Škoda': 'Czech Republic',
  'Smart': 'Germany', 'Subaru': 'Japan', 'Suzuki': 'Japan', 'Tesla': 'United States',
  'Toyota': 'Japan', 'Vauxhall': 'United Kingdom', 'Volkswagen': 'Germany', 'Volvo': 'Sweden',
  // Motorcycles
  'Aprilia': 'Italy', 'Ducati': 'Italy', 'Harley-Davidson': 'United States', 'Indian': 'United States',
  'Kawasaki': 'Japan', 'KTM': 'Austria', 'Moto Guzzi': 'Italy', 'MV Agusta': 'Italy',
  'Royal Enfield': 'India', 'Triumph': 'United Kingdom', 'Yamaha': 'Japan', 'Zero': 'United States'
};

// Curated models for makes NHTSA barely covers (it only tracks US-market
// vehicles, so Škoda, SEAT, Dacia etc. came back empty). Merged with whatever
// NHTSA does return.
const EXTRA_MODELS = {
  'Citroën': ['2CV', 'Ami', 'Berlingo', 'C3', 'C3 Aircross', 'C4', 'C5 Aircross', 'C5 X', 'CX', 'DS', 'SM', 'Xantia'],
  'Cupra': ['Ateca', 'Born', 'Formentor', 'Leon', 'Tavascan', 'Terramar'],
  'Dacia': ['Bigster', 'Duster', 'Jogger', 'Logan', 'Sandero', 'Spring'],
  'MG': ['Cyberster', 'HS', 'MG3', 'MG4', 'MGA', 'MGB', 'MGF', 'Midget', 'TF', 'ZS'],
  'Scion': ['FR-S', 'iA', 'iM', 'iQ', 'tC', 'xA', 'xB', 'xD'],
  'SEAT': ['Alhambra', 'Arona', 'Ateca', 'Ibiza', 'Leon', 'Tarraco', 'Toledo'],
  'Škoda': ['Elroq', 'Enyaq', 'Fabia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Scala', 'Superb', 'Yeti'],
  'Vauxhall': ['Astra', 'Cavalier', 'Corsa', 'Frontera', 'Grandland', 'Insignia', 'Mokka', 'Nova', 'Vectra', 'Zafira']
};

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/';

// AutoDex's vehicle types and the NHTSA lists behind each. NHTSA files
// motorcycles, buses, trailers and bare chassis under the same makes as cars
// (Honda: ~300 motorcycles next to ~25 cars). Its vehicletype filter is a LIKE
// match on the type name: "mpv" is Multipurpose Passenger Vehicle (SUVs and
// minivans), and "truck" covers pickups (and some big rigs, which
// lib/vehicleTypes.js sorts out by name).
const VEHICLE_TYPES = {
  car:        { label: 'Cars',        singular: 'Car',                nhtsa: ['car', 'mpv', 'truck'] },
  motorcycle: { label: 'Motorcycles', singular: 'Motorcycle',         nhtsa: ['motorcycle'] },
  offroad:    { label: 'Off-road',    singular: 'Off-road vehicle',   nhtsa: ['off road vehicle', 'low speed vehicle'] },
  commercial: { label: 'Commercial',  singular: 'Commercial vehicle', nhtsa: ['bus', 'trailer', 'incomplete vehicle'] }
};
const PASSENGER_TYPES = VEHICLE_TYPES.car.nhtsa;

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
// Keyed by whatever make a request names, so bounded: unknown makes from
// crafted URLs must not grow it forever.
const MAX_CACHED_MAKES = 200;
const modelsCache = new Map(); // "type:make" -> { at, data }

function rememberModels(make, data) {
  if (modelsCache.has(make)) modelsCache.delete(make);
  if (modelsCache.size >= MAX_CACHED_MAKES) modelsCache.delete(modelsCache.keys().next().value);
  modelsCache.set(make, { at: Date.now(), data });
}

// Compare make names across sources that disagree on case, accents and
// punctuation (NHTSA says "SKODA", "MERCEDES-BENZ", "ROLLS ROYCE").
function normalizeMake(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

// Map any spelling of a make onto our spelling (car or motorcycle list), or null.
function canonicalMake(name) {
  const wanted = normalizeMake(name);
  if (!wanted) return null;
  return ALL_MAKES.find(m => normalizeMake(m) === wanted) || null;
}

function getMakeCountry(make) {
  return MAKE_COUNTRIES[canonicalMake(make)] || null;
}

async function getMakes() {
  return ALL_MAKES.map(display => ({
    display,
    id: display.toLowerCase(),
    country: MAKE_COUNTRIES[display] || '',
    motorcyclesOnly: MOTORCYCLE_MAKES.includes(display)
  }));
}

// Model names NHTSA lists for a make under one vehicle type. Durably cached
// (lib/cache.js), so the lists survive deploys and a stale copy covers an
// NHTSA outage.
async function getModelsByType(makeDisplay, type) {
  // Query with accents stripped — NHTSA files Citroën as "Citroen"
  const ascii = String(makeDisplay).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const data = await cachedGet(
    `${VPIC}GetModelsForMakeYear/make/${encodeURIComponent(ascii)}/vehicletype/${encodeURIComponent(type)}?format=json`,
    { ttl: CACHE_TTL, timeout: 8000 }
  );
  // NHTSA matches the make as a substring, so asking for "MG" also returns
  // models from CHEMGUARD, MGM Trailers, TMG Trailer and friends. Keep only
  // exact make matches (mergeModels stores our own spelling of the make, so
  // casing stays stable — "SAAB"/"smart" come back inconsistently).
  const wanted = new Set([makeDisplay, ...(NHTSA_MAKE_ALIASES[canonicalMake(makeDisplay)] || [])].map(normalizeMake));
  return (data.Results || [])
    .filter(m => wanted.has(normalizeMake(m.Make_Name)))
    .map(m => m.Model_Name);
}

// Models of one vehicle type for a make — by default cars (cars, SUVs,
// minivans, pickups, plus curated extras). Only a complete answer is cached,
// so a failed lookup is retried.
async function getModels(makeDisplay, { type = 'car' } = {}) {
  const spec = VEHICLE_TYPES[type];
  if (!spec) return [];
  const key = `${type}:${makeDisplay}`;
  const cached = modelsCache.get(key);
  if (cached && (Date.now() - cached.at) < CACHE_TTL) return cached.data;

  const extras = type === 'car' ? EXTRA_MODELS[canonicalMake(makeDisplay)] || [] : [];
  const lists = await Promise.allSettled(spec.nhtsa.map(nhtsaType => getModelsByType(makeDisplay, nhtsaType)));
  const failed = lists.filter(r => r.status === 'rejected');
  // Curated makes still work when NHTSA is down
  const models = mergeModels(
    makeDisplay,
    lists.flatMap(r => (r.status === 'fulfilled' ? r.value : [])),
    extras
  );
  if (failed.length) {
    console.log(`getModels error for ${makeDisplay} (${type}):`, failed[0].reason.message);
  } else {
    rememberModels(key, models);
  }
  return models;
}

function clearModelsCache() {
  modelsCache.clear();
}

// Dedupe case-insensitively (NHTSA "Octavia" vs curated "Octavia"), keeping
// the first spelling seen — NHTSA's, so existing catalog rows still match.
function mergeModels(make, ...lists) {
  const seen = new Set();
  const models = [];
  for (const name of lists.flat()) {
    const key = String(name).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    models.push({ make, model: String(name).trim() });
  }
  return models.sort((a, b) => a.model.localeCompare(b.model));
}

module.exports = {
  MAKES_LIST, MOTORCYCLE_MAKES, ALL_MAKES, VEHICLE_TYPES, PASSENGER_TYPES,
  getMakes, getModels, getModelsByType, clearModelsCache, normalizeMake, canonicalMake, getMakeCountry
};
