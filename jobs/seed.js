// Seed all makes from the international list into the DB so Unsplash can pick them up.
// Runs once on startup in the background — skips makes already in DB, adds a small
// delay between makes to avoid hammering NHTSA.
const db = require('../models');
const carquery = require('../config/carquery');
const { PLACEHOLDER_URL } = require('../lib/constants');

async function seedAllMakes() {
  try {
    const makes = await carquery.getMakes();
    console.log(`Seed: checking ${makes.length} makes...`);
    for (const make of makes) {
      const existing = await db.car.count({ where: { make: make.display } });
      if (existing > 0) continue; // already seeded
      try {
        const models = await carquery.getModels(make.display);
        for (const m of models) {
          await db.car.findOrCreate({
            where: { make: m.make, model: m.model },
            defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false }
          });
        }
        console.log(`Seed: added ${models.length} models for ${make.display}`);
      } catch (err) {
        console.log(`Seed error for ${make.display}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 600)); // 600ms between makes
    }
    console.log('Seed: complete');
  } catch (err) {
    console.log('Seed error:', err.message);
  }
}

module.exports = { seedAllMakes };
