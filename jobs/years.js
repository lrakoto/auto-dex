// Model-year ranges: for each make that still has unscanned catalog rows,
// walk every model year on NHTSA and record year_min/year_max per model.
// ~46 requests per make at 250ms spacing, so a full first pass takes ~15–20
// minutes in the background; after that only makes with newly seeded models
// are rescanned.
const db = require('../models');
const nhtsa = require('../lib/nhtsa'); // referenced via the module so tests can stub it

async function scanMake(make) {
  const ranges = await nhtsa.getModelYears(make);
  await db.sequelize.transaction(async (transaction) => {
    for (const [model, years] of ranges) {
      await db.car.update(
        { model_years: years, year_min: years[0], year_max: years[years.length - 1] },
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
