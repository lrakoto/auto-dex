// Which AutoDex vehicle type a catalog row is (config/carquery.js
// VEHICLE_TYPES), from NHTSA's per-type model lists for its make. The catalog
// was seeded from lists that mix cars, motorcycles, buses and bare chassis
// under one make, and NHTSA renames models over time, so names that no list
// carries any more are classified from their make.
const { MAKES_LIST, MOTORCYCLE_MAKES } = require('../config/carquery');

// ATVs and side-by-sides that NHTSA lists as motorcycles: Honda TRX and
// FourTrax, Suzuki KingQuad and LT-, Yamaha YF-, Kawasaki MULE and Brute
// Force. classifyModel makes them off-road; only ever applied to what would
// otherwise be a motorcycle, so a car named "Viking" stays a car.
const ATV_NAME = /(\bTRX ?\d|\bKing ?Quad|\bQuad ?(Sport|Racer|Master|Runner)|\bLT-[AFZRV]\d|\bYF[MBSZ] ?\d|\bK(VF|LF|EF|SF|FX) ?\d|\bMULE\b|\bTeryx|\bBrute Force|\bPrairie|\bBayou|\bFour ?Trax|\bSport ?Trax|\bSportrax|\bRancher|\bForeman|\bRubicon|\bRecon\b|\bPioneer \d|\bGrizzly|\bKodiak|\bBig Bear|\bTimberwolf|\bWolverine|\bRhino|\bViking\b|\bBanshee|\bBlaster|\bEiger|\bOzark|\bVinson|\b4x4\b|\bATV\b|\bUTV\b)/i;

function isAtvName(model) {
  return ATV_NAME.test(String(model));
}

// Bodies and chassis sold for commercial work, whatever list NHTSA puts them in
const COMMERCIAL_NAME = /\b(chassis|cutaway|motor ?home|stripped|cab[- ]forward|bus|coach|tilt[- ]cab|hi-cube|heavy conventional)\b/i;

// Medium- and heavy-duty trucks NHTSA lists as trucks (or even MPVs) beside
// the pickups. `min` is the smallest series number that counts as heavy.
const HEAVY_SERIES = [
  // F-650 and up and Ford's B/C/L/LN/LT… 6000–9000 series; F-150 to F-550 stay pickups
  { makes: ['Ford'], re: /^(?:B|C|CF|CFT|CL|CLT|CT|F|FT|L|LA|LLA|LN|LNT|LS|LT|LTA|LTL|LTLA|LTLS|LTS)-?\s?(\d{3,4})\b/i, min: 600 },
  // GM C/K/T/W 4500 and up (C1500–C3500 are pickups), and 4500HD-style chassis cabs
  { makes: ['Chevrolet', 'GMC'], re: /^(?:[CKTWPB]\s?)?(\d{4})(?:HD|HG|XD)?\b/i, min: 4500 },
  { makes: ['Ram'], re: /^(\d{4})\b/, min: 4500 },
  // Isuzu N- and F-series cab-overs (NPR, NQR, NRR, FTR, FVR)
  { makes: ['Isuzu'], re: /^[NF][A-Z]R\b/i },
  // Mercedes-Benz L-series trucks (L1317)
  { makes: ['Mercedes-Benz'], re: /^L\s?\d{4}\b/i }
];

// Known exceptions to the rules below, "Make Model" → type
const OVERRIDES = {
  'GMC Typhoon': 'car' // the 1992–93 performance SUV, which NHTSA files with the chassis
};

function isCommercialName(make, model) {
  if (COMMERCIAL_NAME.test(model)) return true;
  return HEAVY_SERIES.some(s => {
    if (!s.makes.includes(make)) return false;
    const m = s.re.exec(model.trim());
    return !!m && (s.min === undefined || parseInt(m[1], 10) >= s.min);
  });
}

// A make NHTSA mostly lists motorcycles for (Honda has ~300 next to ~25 cars)
function motorcycleDominated(lists) {
  const passenger = new Set([...lists.car, ...lists.mpv, ...lists.truck]).size;
  return lists.motorcycle.size >= 3 * Math.max(passenger, 1);
}

// `lists` maps each NHTSA vehicletype query ('car', 'mpv', 'truck',
// 'motorcycle', 'off road vehicle', 'low speed vehicle', 'bus', 'trailer',
// 'incomplete vehicle') to a Set of lowercased model names for this make.
function classifyModel(make, model, lists) {
  const type = classifyListed(make, model, lists);
  return type === 'motorcycle' && isAtvName(model) ? 'offroad' : type;
}

function classifyListed(make, model, lists) {
  const override = OVERRIDES[`${make} ${String(model).trim()}`];
  if (override) return override;
  const name = String(model).trim().toLowerCase();
  const has = type => !!(lists[type] && lists[type].has(name));
  const carMake = MAKES_LIST.includes(make);

  if (isCommercialName(make, model)) return 'commercial';
  if (has('car') || has('mpv')) return 'car';
  // Pickups for car brands; big rigs for the truck builders the old seeder
  // added (Kenworth, International, Hino)
  if (has('truck')) return carMake ? 'car' : 'commercial';
  if (has('motorcycle')) return 'motorcycle';
  if (has('off road vehicle') || has('low speed vehicle')) return 'offroad';
  if (has('bus') || has('trailer') || has('incomplete vehicle')) return 'commercial';

  // Not listed any more: a renamed or retired model. Measured on the dev
  // catalog, unlisted rows in motorcycle-dominated makes were all bikes and
  // ATVs, while in car makes they were renamed cars (Polestar "PS2").
  if (MOTORCYCLE_MAKES.includes(make) || motorcycleDominated(lists)) return 'motorcycle';
  return carMake ? 'car' : 'commercial';
}

module.exports = { classifyModel, isCommercialName, isAtvName };
