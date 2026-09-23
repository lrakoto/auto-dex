// The "Dex": spotting progress per make, plus badges computed from activity.
// Badges are derived on read (nothing stored), so changing thresholds here
// re-scores everyone instantly.
const db = require('../models');

async function getDexStats(userId) {
  const { QueryTypes } = db.Sequelize;
  // Distinct cars spotted per make, alongside that make's catalog size
  const perMake = await db.sequelize.query(`
    SELECT s.make, s.spotted, t.total
    FROM (
      SELECT c.make, COUNT(DISTINCT sp."carId")::int AS spotted
      FROM spottings sp JOIN cars c ON c.id = sp."carId"
      WHERE sp."userId" = :userId
      GROUP BY c.make
    ) s
    JOIN (SELECT make, COUNT(*)::int AS total FROM cars GROUP BY make) t ON t.make = s.make
    ORDER BY s.spotted DESC, s.make ASC
  `, { replacements: { userId }, type: QueryTypes.SELECT });

  const makes = perMake.map(r => ({
    make: r.make,
    spotted: r.spotted,
    total: r.total,
    pct: r.total ? Math.round((r.spotted / r.total) * 100) : 0
  }));
  return {
    makes,
    spottedCars: makes.reduce((n, m) => n + m.spotted, 0),
    spottedMakes: makes.length
  };
}

// Completion for one make — used on the browse page
async function getMakeProgress(userId, make) {
  const [row] = await db.sequelize.query(`
    SELECT COUNT(DISTINCT sp."carId")::int AS spotted
    FROM spottings sp JOIN cars c ON c.id = sp."carId"
    WHERE sp."userId" = :userId AND c.make = :make
  `, { replacements: { userId, make }, type: db.Sequelize.QueryTypes.SELECT });
  return row ? row.spotted : 0;
}

const BADGES = [
  { id: 'first-spot',  icon: '👀', name: 'First Spot',   desc: 'Spot your first car',               test: s => s.spottedCars >= 1 },
  { id: 'spotter',     icon: '🔭', name: 'Spotter',      desc: 'Spot 10 different cars',             test: s => s.spottedCars >= 10 },
  { id: 'road-scholar',icon: '🎓', name: 'Road Scholar', desc: 'Spot 50 different cars',             test: s => s.spottedCars >= 50 },
  { id: 'globetrotter',icon: '🌍', name: 'Globetrotter', desc: 'Spot cars from 10 different makes',  test: s => s.spottedMakes >= 10 },
  { id: 'make-master', icon: '🏆', name: 'Make Master',  desc: 'Spot every model of a make (3+)',    test: s => s.makes.some(m => m.total >= 3 && m.spotted >= m.total) },
  { id: 'garage',      icon: '🔧', name: 'Garage Owner', desc: 'Add a car to your garage',           test: s => s.garageCars >= 1 },
  { id: 'gearhead',    icon: '🛠️', name: 'Gearhead',     desc: 'Log a maintenance entry',            test: s => s.maintenanceLogs >= 1 },
  { id: 'collector',   icon: '♥',  name: 'Collector',    desc: 'Favorite 10 cars',                   test: s => s.favorites >= 10 },
  { id: 'curator',     icon: '🖼️', name: 'Curator',      desc: 'Have a photo approved for the catalog', test: s => s.approvedImages >= 1 }
];

async function getBadges(userId, dexStats) {
  const stats = dexStats || await getDexStats(userId);
  const [garageCars, favorites, approvedImages, maintenanceLogs] = await Promise.all([
    db.user_car.count({ where: { userId } }),
    db.favorite_car.count({ where: { userId } }),
    db.image_proposal.count({ where: { userId, status: 'approved' } }),
    db.maintenance_log.count({ include: [{ model: db.user_car, where: { userId }, attributes: [] }] })
  ]);
  const all = { ...stats, garageCars, favorites, approvedImages, maintenanceLogs };
  return BADGES.map(b => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: b.test(all) }));
}

module.exports = { getDexStats, getMakeProgress, getBadges, BADGES };
