// Model-year ranges: for each make that still has unscanned catalog rows,
// walk every model year on NHTSA and record year_min/year_max per model.
// ~46 requests per make at 250ms spacing, so a full first pass takes ~15–20
// minutes in the background; after that only makes with newly seeded models
// are rescanned.
const { isDeepStrictEqual } = require('node:util');
const db = require('../models');
const nhtsa = require('../lib/nhtsa'); // referenced via the module so tests can stub it

// The vPIC list includes pre-launch years for this exact trim and omits 1997.
// FuelEconomy.gov lists it in U.S. model years 1994–1997.
const VERIFIED_MODEL_YEARS = [{ make: 'BMW', model: '840Ci', years: [1994, 1995, 1996, 1997] }];

function yearFields(years) {
  return { model_years: years, year_min: years[0], year_max: years[years.length - 1] };
}

// Correct saved rows even when a make has no pending scan. No network request
// is needed to apply years already verified against the source.
async function applyVerifiedModelYears() {
  for (const { make, model, years } of VERIFIED_MODEL_YEARS) {
    const values = { ...yearFields(years), years_checked: true };
    const car = await db.car.findOne({ where: { make, model }, attributes: ['id', ...Object.keys(values)] });
    if (car && Object.entries(values).some(([field, value]) => !isDeepStrictEqual(car[field], value))) {
      await car.update(values);
    }
  }
}

async function scanMake(make) {
  const ranges = new Map(await nhtsa.getModelYears(make));
  for (const verified of VERIFIED_MODEL_YEARS) {
    if (verified.make === make) ranges.set(verified.model, verified.years);
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
