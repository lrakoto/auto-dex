// Entry point for in-process background jobs. Only called when the server is
// run directly (not tests), and disabled entirely with ENABLE_BACKGROUND_JOBS=false.
const { unsplashImages } = require('./images');
const { seedAllMakes } = require('./seed');
const { scanYears } = require('./years');
const { classifyVehicleTypes } = require('./vehicleTypes');
const { pruneCache } = require('../lib/cache');

const UNSPLASH_INTERVAL_MS = 3700000; // ~1 hour
const YEARS_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily — picks up newly seeded makes/models

function startBackgroundJobs() {
  // Overlap guard: if a run exceeds the interval, skip the stacked invocation
  let unsplashRunning = false;
  async function unsplashImagesGuarded() {
    if (unsplashRunning) return;
    unsplashRunning = true;
    try {
      await unsplashImages();
    } finally {
      unsplashRunning = false;
    }
  }

  const unsplashTimer = setInterval(unsplashImagesGuarded, UNSPLASH_INTERVAL_MS);
  unsplashTimer.unref(); // don't hold the process open
  unsplashImagesGuarded(); // run once on startup

  // Run after a short delay so the server is fully up first. Vehicle types
  // and the year scan follow the seed (they need the rows; typing can add
  // models, which the year scan then dates) and repeat daily.
  let upkeepRunning = false;
  async function catalogUpkeep() {
    if (upkeepRunning) return;
    upkeepRunning = true;
    try {
      await classifyVehicleTypes();
      await scanYears();
    } finally {
      upkeepRunning = false;
    }
  }
  setTimeout(async () => {
    await seedAllMakes();
    await catalogUpkeep();
  }, 5000).unref();
  setInterval(catalogUpkeep, YEARS_INTERVAL_MS).unref();

  // Daily: clear month-old rows out of the durable API cache
  setInterval(() => {
    pruneCache().catch(err => console.log('Cache prune error:', err.message));
  }, 24 * 60 * 60 * 1000).unref();
}

module.exports = { startBackgroundJobs };
