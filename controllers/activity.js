const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../models');
const isLoggedIn = require('../middleware/isLoggedIn');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { RECENT_SPOTS } = require('../lib/dex');
const { isValidImageUrl } = require('../lib/validators');

const router = express.Router();
const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const voteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const { Op } = db.Sequelize;
const utcDay = now => now.toISOString().slice(0, 10);

function recentSightings(transaction) {
  // Apply the public feed's cap before filtering for photos. The ballot
  // cannot resurface a photo outside that garage's own recent list.
  return db.spotting.findAll({
    attributes: ['id', 'userId', 'createdAt', 'imageUrl'],
    include: [
      { model: db.user, attributes: ['username'], where: { garagePublic: true, username: { [Op.ne]: '' } } },
      { model: db.car, attributes: ['make', 'model'], required: true }
    ],
    ...RECENT_SPOTS,
    transaction
  });
}

function photoCandidates(recent, voteDay, now) {
  const firstDay = Date.parse(`${voteDay}T00:00:00Z`) - 6 * 86400000;
  return recent.filter(spot => spot.createdAt >= firstDay && spot.createdAt <= now &&
    spot.imageUrl !== PLACEHOLDER_URL && isValidImageUrl(spot.imageUrl));
}

function publicSighting({ car, user, createdAt }) {
  return {
    make: car.make,
    model: car.model,
    carUrl: `/cars/car?make=${encodeURIComponent(car.make)}&model=${encodeURIComponent(car.model)}`,
    garageName: `@${user.username}`,
    garageUrl: `/u/${encodeURIComponent(user.username)}`,
    dateIso: utcDay(createdAt),
    dateLabel: dayLabel.format(createdAt)
  };
}

async function ballot(recent, voteDay, now, userId) {
  const eligible = photoCandidates(recent, voteDay, now);
  if (!eligible.length) return { candidates: [], hasVote: false };

  const [totals, ownVote] = await Promise.all([
    db.spot_vote.findAll({
      attributes: ['spottingId', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'votes']],
      where: { voteDay, spottingId: eligible.map(spot => spot.id) },
      group: ['spottingId'],
      raw: true
    }),
    userId ? db.spot_vote.findOne({ where: { userId, voteDay }, attributes: ['spottingId'] }) : null
  ]);
  const votesBySpot = new Map(totals.map(row => [row.spottingId, Number(row.votes)]));
  const top = Math.max(0, ...votesBySpot.values());
  const leaders = totals.filter(row => Number(row.votes) === top);
  const leadingId = leaders.length === 1 ? leaders[0].spottingId : null;
  return {
    hasVote: Boolean(ownVote),
    candidates: eligible.map(spot => ({
      ...publicSighting(spot),
      id: spot.id,
      imageUrl: spot.imageUrl.trim(),
      votes: votesBySpot.get(spot.id) || 0,
      isMine: ownVote?.spottingId === spot.id,
      canVote: Boolean(userId && userId !== spot.userId),
      isLeading: spot.id === leadingId
    }))
  };
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const voteDay = utcDay(now);
    const recent = await recentSightings();
    res.render('activity', {
      spots: recent.map(publicSighting),
      voteDay,
      ...await ballot(recent, voteDay, now, req.user?.id),
      pageTitle: 'Recent Sightings — AutoDex',
      pageDescription: 'See what AutoDex members have spotted in their public garages.',
      canonicalPath: '/activity',
      noindex: true
    });
  } catch (err) {
    next(err);
  }
});

router.post('/vote', isLoggedIn, voteLimiter, async (req, res, next) => {
  const now = new Date();
  const voteDay = utcDay(now);
  const { spottingId: input, day, action } = req.body;
  const spottingId = Number(input);
  if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input) || spottingId > 2147483647 ||
      typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !['vote', 'withdraw'].includes(action)) {
    return res.status(400).send('Choose a sighting and voting action.');
  }
  if (day !== voteDay) return res.status(409).send('Voting has reset. Reload the sightings page.');

  try {
    const userId = req.user.id;
    if (action === 'withdraw') {
      await db.spot_vote.destroy({ where: { userId, voteDay, spottingId } });
    } else {
      const cast = await db.sequelize.transaction(async transaction => {
        const spot = await db.spotting.findByPk(spottingId, { attributes: ['userId'], transaction });
        if (!spot || spot.userId === userId) return false;
        // Lock the owner first, matching the lock order of a cascading account
        // delete. Recheck the sighting and public feed under those locks.
        const owner = await db.user.findByPk(spot.userId, {
          attributes: ['garagePublic', 'username'], transaction, lock: transaction.LOCK.SHARE
        });
        if (!owner?.garagePublic || !owner.username) return false;
        const locked = await db.spotting.findOne({
          attributes: ['id'], where: { id: spottingId, userId: spot.userId }, transaction, lock: transaction.LOCK.SHARE
        });
        if (!locked) return false;
        const recent = await recentSightings(transaction);
        if (!photoCandidates(recent, voteDay, now).some(candidate => candidate.id === spottingId)) return false;
        await db.spot_vote.upsert({ userId, voteDay, spottingId }, { transaction, conflictFields: ['userId', 'voteDay'] });
        return true;
      });
      if (!cast) return res.status(404).send('That sighting is unavailable for voting.');
    }
    res.redirect('/activity#spot-of-the-day');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
