// Entry point for in-process background jobs. Only called when the server is
// run directly (not tests), and disabled entirely with ENABLE_BACKGROUND_JOBS=false.
const { unsplashImages } = require('./images');
const { seedAllMakes } = require('./seed');

const UNSPLASH_INTERVAL_MS = 3700000; // ~1 hour

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

  // Run after a short delay so the server is fully up first
  setTimeout(seedAllMakes, 5000).unref();
}

module.exports = { startBackgroundJobs };
