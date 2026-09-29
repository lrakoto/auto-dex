// Vehicle types for the catalog (lib/vehicleTypes.js). For each make that has
// rows without a type: fetch NHTSA's list of every vehicle type, classify
// those rows, and add the car and motorcycle models NHTSA lists that the
// catalog doesn't have yet. Nothing is deleted. The first run touches every
// make (~9 cached lookups each); after that only makes with new untyped rows.
const db = require('../models');
const carquery = require('../config/carquery'); // via the module so tests can stub it
const { PLACEHOLDER_URL } = require('../lib/constants');
const { classifyModel } = require('../lib/vehicleTypes');

const NHTSA_TYPES = [...new Set(Object.values(carquery.VEHICLE_TYPES).flatMap(t => t.nhtsa))];

// { nhtsaType: Set(lowercased model names) }. Throws if any lookup fails, so
// a make is never classified from partial lists.
async function typeLists(make, { delayMs = 100 } = {}) {
  const lists = {};
  for (const type of NHTSA_TYPES) {
    lists[type] = new Set((await carquery.getModelsByType(make, type)).map(n => String(n).trim().toLowerCase()));
    if (delayMs) await new Promise(r => setTimeout(r, delayMs)); // be polite to NHTSA
  }
  return lists;
}

// Car and motorcycle models NHTSA lists for a curated make that the catalog lacks
async function addMissingModels(make) {
  if (!carquery.ALL_MAKES.includes(make)) return 0;
  const existing = new Set((await db.car.findAll({ attributes: ['model'], where: { make } }))
    .map(r => r.model.trim().toLowerCase()));
  const rows = [];
  for (const type of ['car', 'motorcycle']) {
    for (const { model } of await carquery.getModels(make, { type })) {
      const key = model.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      rows.push({ make, model, image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: type });
    }
  }
  if (rows.length) await db.car.bulkCreate(rows, { ignoreDuplicates: true });
  return rows.length;
}

async function classifyMake(make, options) {
  const lists = await typeLists(make, options);
  const rows = await db.car.findAll({ attributes: ['id', 'model'], where: { make, vehicle_type: null } });
  const byType = {};
  for (const row of rows) {
    const type = classifyModel(make, row.model, lists);
    (byType[type] = byType[type] || []).push(row.id);
  }
  await db.sequelize.transaction(async (transaction) => {
    for (const [type, ids] of Object.entries(byType)) {
      await db.car.update({ vehicle_type: type }, { where: { id: ids }, transaction });
    }
  });
  const added = await addMissingModels(make);
  return { classified: rows.length, added, byType: Object.fromEntries(Object.entries(byType).map(([t, ids]) => [t, ids.length])) };
}

async function classifyVehicleTypes({ maxMakes = Infinity, delayMs = 100 } = {}) {
  try {
    const pending = await db.car.findAll({
      attributes: ['make'],
      where: { vehicle_type: null },
      group: ['make'],
      order: [['make', 'ASC']]
    });
    const makes = pending.map(r => r.make).slice(0, maxMakes);
    if (makes.length === 0) return;
    console.log(`Vehicle types: classifying ${makes.length} makes...`);
    for (const make of makes) {
      try {
        const { classified, added, byType } = await classifyMake(make, { delayMs });
        console.log(`Vehicle types: ${make}: ${classified} classified ${JSON.stringify(byType)}, ${added} models added`);
      } catch (err) {
        console.log(`Vehicle types error for ${make} (retried next run):`, err.message);
      }
    }
    console.log('Vehicle types: complete');
  } catch (err) {
    console.log('Vehicle types error:', err.message);
  }
}

module.exports = { classifyVehicleTypes, classifyMake };
