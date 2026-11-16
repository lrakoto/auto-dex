// Model-year ranges: for each make that still has unscanned catalog rows,
// walk every model year on NHTSA and record year_min/year_max per model.
// ~46 requests per make at 250ms spacing, so a full first pass takes ~15–20
// minutes in the background; after that only makes with newly seeded models
// are rescanned.
const { isDeepStrictEqual } = require('node:util');
const db = require('../models');
const nhtsa = require('../lib/nhtsa'); // referenced via the module so tests can stub it
const { findOrCreateCatalogCar } = require('../lib/catalog');
const { VERIFIED_MODEL_YEARS, yearFields } = require('../lib/verified-model-years');
const { Op } = db.Sequelize;

function verifiedYears({ years, addToScannedYears }, recordedYears) {
  if (!addToScannedYears) return years;
  return [...new Set([...years, ...(recordedYears || [])])].sort((a, b) => a - b);
}

// Correct saved rows and seed verified supplemental models even when a make
// has no pending scan. The source records are already verified.
async function applyVerifiedModelYears() {
  for (const verified of VERIFIED_MODEL_YEARS) {
    const { make, model, supplemental, addToScannedYears } = verified;
    const car = supplemental
      ? await findOrCreateCatalogCar(make, model)
      : await db.car.findOne({ where: { make, model }, attributes: ['id', 'model_years', 'year_min', 'year_max', 'years_checked'] });
    if (!car) continue;
    const values = yearFields(verifiedYears(verified, car.model_years));
    if (!addToScannedYears) values.years_checked = true;
    if (Object.entries(values).every(([field, value]) => isDeepStrictEqual(car[field], value))) continue;
    if (addToScannedYears) {
      // A concurrent scan already adds these years to its fresh results.
      await db.car.update(values, { where: { id: car.id, model_years: { [Op.eq]: car.model_years } } });
    } else {
      await car.update(values);
    }
  }
}

async function scanMake(make) {
  const ranges = new Map(await nhtsa.getModelYears(make));
  for (const verified of VERIFIED_MODEL_YEARS) {
    if (verified.make !== make) continue;
    const scanned = ranges.get(verified.model);
    // With no new result, retain this model's existing years in the catalog.
    if (verified.addToScannedYears && !scanned?.length) continue;
    ranges.set(verified.model, verifiedYears(verified, scanned));
  }
  await db.sequelize.transaction(async (transaction) => {
    for (const [model, years] of ranges) {
      await db.car.update(
        yearFields(years),
        { where: { make, model }, transaction }
      );
    }
    // Mark the whole make scanned — models NHTSA has no year data for keep
    // null years rather than being retried forever.
    await db.car.update({ years_checked: true }, { where: { make }, transaction });
  });
  return ranges.size;
}

async function scanYears({ maxMakes = Infinity } = {}) {
  try {
    await applyVerifiedModelYears();
    const pending = await db.car.findAll({
      attributes: ['make'],
      where: { years_checked: false },
      group: ['make'],
      order: [['make', 'ASC']]
    });
    const makes = pending.map(r => r.make).slice(0, maxMakes);
    if (makes.length === 0) return;
    console.log(`Years: scanning ${makes.length} makes...`);
    for (const make of makes) {
      try {
        const n = await scanMake(make);
        console.log(`Years: ${make} — ${n} models dated`);
      } catch (err) {
        console.log(`Years error for ${make}:`, err.message);
      }
    }
    console.log('Years: complete');
  } catch (err) {
    console.log('Years error:', err.message);
  }
}

module.exports = { scanYears, scanMake };
