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
    // One query to find which makes already have rows (was one count per make)
    const haveRows = await db.car.findAll({
      attributes: ['make'],
      group: ['make']
    });
    const seeded = new Set(haveRows.map(r => r.make));
    for (const make of makes) {
      if (seeded.has(make.display)) continue; // already seeded
      try {
        const models = await carquery.getModels(make.display);
        if (models.length > 0) {
          // Single INSERT ... ON CONFLICT DO NOTHING per make instead of a
          // findOrCreate round-trip per model. Relies on the cars(make, model)
          // unique index added in 20260916000000.
          await db.car.bulkCreate(
            models.map(m => ({
              make: m.make,
              model: m.model,
              image: PLACEHOLDER_URL,
              favcount: 0,
              updated_img: false
            })),
            { ignoreDuplicates: true }
          );
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
