/**
 * One-off repair: recompute cars.favcount from favorite_cars.
 * Needed because favcount was broken for a long time (never incremented on add,
 * never decremented on remove), so existing values are stale.
 *
 * Run locally:   node scripts/recount-favcounts.js
 * Run on server: cd /var/www/autodex && NODE_ENV=production node scripts/recount-favcounts.js
 */
const db = require('../models');

(async () => {
  try {
    const [result] = await db.sequelize.query(`
      UPDATE cars
      SET favcount = COALESCE(counts.total, 0)
      FROM (SELECT "carId", COUNT(*) AS total FROM favorite_cars GROUP BY "carId") AS counts
      WHERE counts."carId" = cars.id;
    `);
    // Reset cars with no favorites to 0 (the FROM clause above skips them)
    const [zeroed] = await db.sequelize.query(`
      UPDATE cars
      SET favcount = 0
      WHERE favcount <> 0
        AND id NOT IN (SELECT DISTINCT "carId" FROM favorite_cars);
    `);
    const zeroedCount = zeroed && zeroed.rowCount != null ? zeroed.rowCount : 'n/a';
    console.log(`favcount repair complete (zeroed stale counts on ${zeroedCount} cars).`);
  } catch (err) {
    console.error('RECOUNT FAILED:', err);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
})();
