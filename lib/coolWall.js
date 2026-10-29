// Cool Wall (R10): signed-in users place a car in one of four tiers, Top
// Gear style. A car's placement is the rounded mean of its votes; the wall
// at /cars/cool-wall lists every voted car under its placement.
const db = require('../models');
const { displayPhoto } = require('./photoPolicy'); // raw SQL skips the model's photo getter

// Index = the value stored in cool_votes.tier
const TIERS = [
  { key: 'seriously-uncool', label: 'Seriously Uncool' },
  { key: 'uncool', label: 'Uncool' },
  { key: 'cool', label: 'Cool' },
  { key: 'sub-zero', label: 'Sub-Zero' }
];

const WALL_PER_TIER = 24;

function tierIndex(key) {
  return TIERS.findIndex(t => t.key === key);
}

// Pure: votes per tier → { counts, total, placement } where placement is the
// tier index nearest the mean (halves round up, toward cool), or null
function tally(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return { counts, total, placement: null };
  const mean = counts.reduce((sum, n, i) => sum + n * i, 0) / total;
  return { counts, total, placement: Math.min(TIERS.length - 1, Math.floor(mean + 0.5)) };
}

// The car page's panel: the community tally and the viewer's own vote
async function getCarCool(carId, userId) {
  const counts = TIERS.map(() => 0);
  if (!carId) return { ...tally(counts), mine: null };
  const [rows, mine] = await Promise.all([
    db.cool_vote.findAll({
      attributes: ['tier', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'n']],
      where: { carId },
      group: ['tier'],
      raw: true
    }),
    userId ? db.cool_vote.findOne({ where: { carId, userId }, attributes: ['tier'] }) : null
  ]);
  rows.forEach(r => { counts[r.tier] = Number(r.n); });
  return { ...tally(counts), mine: mine ? mine.tier : null };
}

// Record a vote; voting for your current tier again takes the vote back.
// Returns the viewer's tier afterwards (null when cleared).
async function castVote(carId, userId, tier) {
  const existing = await db.cool_vote.findOne({ where: { carId, userId } });
  if (existing && existing.tier === tier) {
    await existing.destroy();
    return null;
  }
  if (existing) {
    await existing.update({ tier });
    return tier;
  }
  try {
    await db.cool_vote.create({ carId, userId, tier });
  } catch (err) {
    // A double-click can race the findOne; the unique index keeps one row
    if (!(err instanceof db.Sequelize.UniqueConstraintError)) throw err;
    await db.cool_vote.update({ tier }, { where: { carId, userId } });
  }
  return tier;
}

// Every voted car, under its placement: [{ ...tier, cars: [{ make, model,
// image, total }] }], most-voted first within a tier
async function getWall(perTier = WALL_PER_TIER) {
  const [rows] = await db.sequelize.query(`
    SELECT c.id, c.make, c.model, c.image, v.total, v.mean
    FROM (
      SELECT "carId", COUNT(*)::int AS total, AVG(tier)::float AS mean
      FROM cool_votes GROUP BY "carId"
    ) v
    JOIN cars c ON c.id = v."carId"
    ORDER BY v.total DESC, c.make, c.model
  `);
  const wall = TIERS.map((t, index) => ({ ...t, index, cars: [] }));
  for (const r of rows) {
    const column = wall[Math.min(TIERS.length - 1, Math.floor(r.mean + 0.5))];
    if (column.cars.length < perTier) column.cars.push({ make: r.make, model: r.model, image: displayPhoto(r.image), total: r.total });
  }
  return wall;
}

module.exports = { TIERS, tierIndex, tally, getCarCool, castVote, getWall, WALL_PER_TIER };
