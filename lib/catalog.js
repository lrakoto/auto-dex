// Resolve catalog cars and makes from user input (forms, URLs).
const db = require('../models');
const carquery = require('../config/carquery'); // via the module so tests can stub getModels
const { MAKES_LIST, canonicalMake } = carquery;
const { PLACEHOLDER_URL } = require('./constants');

const { Op, fn, col, where } = db.Sequelize;

function isText(v) {
  return typeof v === 'string' && v.trim() !== '';
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
    defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false }
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
// { make, model, car } in the catalog's spelling — car is the DB row, or null
// for a model NHTSA lists that hasn't been seeded yet — or null when the car
// isn't in the catalog at all.
async function lookupCatalogCar(make, model) {
  if (!isText(make) || !isText(model)) return null;
  const hit = await db.car.findOne({ where: { make, model } })
    || await db.car.findOne({ where: { [Op.and]: [lowerEq('make', make), lowerEq('model', model)] } });
  if (hit) return { make: hit.make, model: hit.model, car: hit };

  const canonical = canonicalMake(make);
  if (!canonical) return null;
  if (canonical !== make) {
    // "skoda octavia" → the Škoda row
    const row = await db.car.findOne({ where: { [Op.and]: [{ make: canonical }, lowerEq('model', model)] } });
    if (row) return { make: row.make, model: row.model, car: row };
  }
  const wanted = model.trim().toLowerCase();
  const listed = (await carquery.getModels(canonical)).find(m => m.model.toLowerCase() === wanted);
  return listed ? { make: canonical, model: listed.model, car: null } : null;
}

// Cars worth featuring (quiz, Car of the Day): MAKES_LIST makes with a real
// photo. `makes` narrows it further.
function photoPoolWhere({ makes = MAKES_LIST, ...extra } = {}) {
  return {
    make: { [Op.in]: makes },
    image: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: PLACEHOLDER_URL }] },
    ...extra
  };
}

// The cars (order kept) whose model NHTSA or the curated list names as a
// passenger vehicle of its make. Rows seeded before the vehicle-type filter
// include motorcycles, buses and chassis, not yet classified. An empty list
// means the lookup failed, so it doesn't count against a car. One getModels
// per distinct make, in parallel.
async function filterListed(cars) {
  const makes = [...new Set(cars.map(c => c.make))];
  const lists = new Map(await Promise.all(makes.map(async m => [m, await carquery.getModels(m)])));
  return cars.filter(c => {
    const models = lists.get(c.make);
    return models.length === 0 || models.some(m => m.model === c.model);
  });
}

module.exports = { findOrCreateCatalogCar, lookupMake, lookupCatalogCar, photoPoolWhere, filterListed };
