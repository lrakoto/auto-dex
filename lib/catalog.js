// Resolve catalog cars and makes from user input (forms, URLs).
const db = require('../models');
const carquery = require('../config/carquery'); // via the module so tests can stub getModels
const { MAKES_LIST, ALL_MAKES, canonicalMake } = carquery;
const { PLACEHOLDER_URL } = require('./constants');

const { Op, fn, col, where } = db.Sequelize;

function isText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// Where-clause fragment for one vehicle type. Rows jobs/vehicleTypes.js
// hasn't classified yet count as cars, which most of them are.
function vehicleTypeWhere(type) {
  return type === 'car'
    ? { [Op.or]: [{ vehicle_type: 'car' }, { vehicle_type: null }] }
    : { vehicle_type: type };
}

// Case-insensitive column match without LIKE (no wildcard escaping needed)
function lowerEq(column, value) {
  return where(fn('lower', col(column)), String(value).trim().toLowerCase());
}

// Resolve a catalog car by make/model, creating the row only if NHTSA actually
// lists that model for the make — so user-facing endpoints that take
// make/model from a form can't be used to seed junk into the catalog.
async function findOrCreateCatalogCar(make, model) {
  if (!isText(make) || !isText(model)) return null;
  const existing = await db.car.findOne({ where: { make, model } });
  if (existing) return existing;
  const models = await carquery.getModels(make);
  if (!models.some(m => m.model === model)) return null;
  const [car] = await db.car.findOrCreate({
    where: { make, model },
    defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car' }
  });
  return car;
}

// The catalog's spelling of a make: MAKES_LIST in any spelling ("skoda" →
// Škoda), or a make the catalog has rows for (any case). Null for anything
// else, so crafted URLs never reach NHTSA.
async function lookupMake(make) {
  if (!isText(make)) return null;
  const canonical = canonicalMake(make);
  if (canonical) return canonical;
  const row = await db.car.findOne({ attributes: ['make'], where: lowerEq('make', make) });
  return row ? row.make : null;
}

// Resolve make/model from a URL without creating anything. Returns
// { make, model, car, type } in the catalog's spelling — car is the DB row, or
// null for a car or motorcycle NHTSA lists that hasn't been seeded yet — or
// null when the vehicle isn't in the catalog at all.
async function lookupCatalogCar(make, model) {
  if (!isText(make) || !isText(model)) return null;
  const found = row => ({ make: row.make, model: row.model, car: row, type: row.vehicle_type || 'car' });
  const hit = await db.car.findOne({ where: { make, model } })
    || await db.car.findOne({ where: { [Op.and]: [lowerEq('make', make), lowerEq('model', model)] } });
  if (hit) return found(hit);

  const canonical = canonicalMake(make);
  if (!canonical) return null;
  if (canonical !== make) {
    // "skoda octavia" → the Škoda row
    const row = await db.car.findOne({ where: { [Op.and]: [{ make: canonical }, lowerEq('model', model)] } });
    if (row) return found(row);
  }
  const wanted = model.trim().toLowerCase();
  for (const type of ['car', 'motorcycle']) {
    const listed = (await carquery.getModels(canonical, { type })).find(m => m.model.toLowerCase() === wanted);
    if (listed) return { make: canonical, model: listed.model, car: null, type };
  }
  return null;
}

// Cars worth featuring (quiz, Car of the Day): cars of MAKES_LIST makes with
// a real photo. `makes` narrows it further; another `type` (the motorcycle
// quiz) draws from every make of that type.
function photoPoolWhere({ makes, type = 'car', ...extra } = {}) {
  return {
    make: { [Op.in]: makes || (type === 'car' ? MAKES_LIST : ALL_MAKES) },
    image: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: PLACEHOLDER_URL }] },
    ...vehicleTypeWhere(type),
    ...extra
  };
}

// The cars (order kept) whose model NHTSA or the curated list names as a
// passenger vehicle of its make (or, with `type`, a vehicle of that type). Rows seeded before the vehicle-type filter
// include motorcycles, buses and chassis, not yet classified. An empty list
// means the lookup failed, so it doesn't count against a car. One getModels
// per distinct make, in parallel.
async function filterListed(cars, { type = 'car' } = {}) {
  const makes = [...new Set(cars.map(c => c.make))];
  const lists = new Map(await Promise.all(makes.map(async m => [m, await carquery.getModels(m, { type })])));
  return cars.filter(c => {
    const models = lists.get(c.make);
    return models.length === 0 || models.some(m => m.model === c.model);
  });
}

module.exports = { findOrCreateCatalogCar, lookupMake, lookupCatalogCar, photoPoolWhere, filterListed, vehicleTypeWhere };
