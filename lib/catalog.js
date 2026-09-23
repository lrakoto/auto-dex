// Resolve a catalog car by make/model, creating the row only if NHTSA actually
// lists that model for the make — so user-facing endpoints that take
// make/model from a form can't be used to seed junk into the catalog.
const db = require('../models');
const { getModels } = require('../config/carquery');
const { PLACEHOLDER_URL } = require('./constants');

async function findOrCreateCatalogCar(make, model) {
  if (typeof make !== 'string' || typeof model !== 'string' || !make.trim() || !model.trim()) return null;
  const existing = await db.car.findOne({ where: { make, model } });
  if (existing) return existing;
  const models = await getModels(make);
  if (!models.some(m => m.model === model)) return null;
  const [car] = await db.car.findOrCreate({
    where: { make, model },
    defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false }
  });
  return car;
}

module.exports = { findOrCreateCatalogCar };
