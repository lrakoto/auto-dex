// Resolve catalog cars and makes from user input (forms, URLs).
const db = require('../models');
const carquery = require('../config/carquery'); // via the module so tests can stub getModels
const { MAKES_LIST, ALL_MAKES, canonicalMake } = carquery;
const { PLACEHOLDER_URL } = require('./constants');
const { RETIRED_PHOTO_PATTERN } = require('./photoPolicy');
const { isCommercialName } = require('./vehicleTypes');
const { VERIFIED_MODEL_YEARS, yearFields } = require('./verified-model-years');

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

function modelSpacingMatch(query) {
  const withoutSpaces = value => fn('lower', fn('regexp_replace', value, '[[:space:]]+', '', 'g'));
  return where(withoutSpaces(col('model')), withoutSpaces(query));
}

function modelSearchOptions(query, make) {
  const literal = where(fn('lower', col('model')), fn('lower', query));
  const spacing = modelSpacingMatch(query);
  const contains = { [Op.iLike]: '%' + query + '%' };
  const filter = { [Op.or]: [{ model: contains }, spacing] };
  if (make) filter.make = make;
  else filter[Op.or].push({ make: contains });
  return {
    where: filter,
    order: [[literal, 'DESC NULLS LAST'], [spacing, 'DESC NULLS LAST'], ['favcount', 'DESC'], ['id', 'ASC']]
  };
}

function supplementalModelFor(make, model) {
  const wanted = model.trim().toLowerCase();
  return VERIFIED_MODEL_YEARS.find(entry =>
    entry.supplemental && entry.make === make && entry.model.toLowerCase() === wanted
  );
}

// Resolve a catalog car by make/model, creating a row only for a verified
// supplement or a model supplied by the make's catalog list.
async function findOrCreateCatalogCar(make, model) {
  if (!isText(make) || !isText(model)) return null;
  const supplemental = supplementalModelFor(canonicalMake(make), model);
  const identity = supplemental ? { make: supplemental.make, model: supplemental.model } : { make, model };
  const existing = await db.car.findOne({ where: identity });
  if (existing) return existing;
  if (!supplemental) {
    const models = await carquery.getModels(make);
    if (!models.some(m => m.model === model)) return null;
  }
  const vehicleType = isCommercialName(identity.make, identity.model) ? 'commercial' : 'car';
  const years = supplemental ? { ...yearFields(supplemental.years), years_checked: true } : {};
  const [car] = await db.car.findOrCreate({
    where: identity,
    defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: vehicleType, ...years }
  });
  return car;
}

// Keep exact catalog links on their stored make. Otherwise prefer the curated
// spelling ("skoda" → Škoda), then a case-insensitive catalog match.
async function lookupMake(make) {
  if (!isText(make)) return null;
  const requested = make.trim();
  const canonical = canonicalMake(requested);
  if (canonical === requested) return canonical;
  const exact = await db.car.findOne({ attributes: ['make'], where: { make: requested } });
  if (exact) return exact.make;
  if (canonical) return canonical;
  const row = await db.car.findOne({
    attributes: ['make'],
    where: lowerEq('make', requested),
    order: [['make', 'ASC']]
  });
  return row ? row.make : null;
}

// Resolve make/model from a URL without creating anything. Returns
// { make, model, car, type } in the catalog's spelling — car is the DB row, or
// null for a known catalog model that hasn't been seeded yet — or
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
  const supplemental = supplementalModelFor(canonical, model);
  if (supplemental) return { make: canonical, model: supplemental.model, car: null, type: 'car' };
  const wanted = model.trim().toLowerCase();
  for (const type of ['car', 'motorcycle']) {
    const listed = (await carquery.getModels(canonical, { type })).find(m => m.model.toLowerCase() === wanted);
    if (listed) {
      const resolvedType = type === 'car' && isCommercialName(canonical, listed.model) ? 'commercial' : type;
      return { make: canonical, model: listed.model, car: null, type: resolvedType };
    }
  }
  return null;
}

// Cars worth featuring (quiz, Car of the Day): cars of MAKES_LIST makes with
// a real photo. `makes` narrows it further; another `type` (the motorcycle
// quiz) draws from every make of that type.
function photoPoolWhere({ makes, type = 'car', ...extra } = {}) {
  return {
    make: { [Op.in]: makes || (type === 'car' ? MAKES_LIST : ALL_MAKES) },
    image: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: PLACEHOLDER_URL }, { [Op.notIRegexp]: RETIRED_PHOTO_PATTERN }] },
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

module.exports = {
  findOrCreateCatalogCar, lookupMake, lookupCatalogCar, photoPoolWhere, filterListed, vehicleTypeWhere,
  modelSpacingMatch, modelSearchOptions
};
