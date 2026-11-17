const { createHmac, timingSafeEqual } = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../models');
const isLoggedIn = require('../middleware/isLoggedIn');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { BADGES, RECENT_SPOTS } = require('../lib/dex');
const { getRecentRecords } = require('../lib/quiz');
const { isValidImageUrl } = require('../lib/validators');

const router = express.Router();
const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const voteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const { Op } = db.Sequelize;
const utcDay = now => now.toISOString().slice(0, 10);
const firstSpotBadge = BADGES.find(badge => badge.id === 'first-spot');
const carWhispererBadge = BADGES.find(badge => badge.id === 'car-whisperer');

function recentSightings({ transaction, includeFirstSpot = false } = {}) {
  const attributes = ['id', 'userId', 'createdAt', 'imageUrl'];
  if (includeFirstSpot) {
    // Check the retained ledger, including sightings older than the feed.
    // Only the boolean for an already-public feed row is returned.
    attributes.push([db.sequelize.literal(`NOT EXISTS (
      SELECT 1 FROM spottings AS earlier
      WHERE earlier."userId" = "spotting"."userId"
        AND (earlier."createdAt", earlier.id) < ("spotting"."createdAt", "spotting".id)
    )`), 'isFirstRetained']);
  }
  // Apply the public feed's cap before filtering for photos. The ballot
  // cannot resurface a photo outside that garage's own recent list.
  return db.spotting.findAll({
    attributes,
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

function ownVoteFor(userId, voteDay) {
  return db.spot_vote.findOne({ where: { userId, voteDay }, attributes: ['id', 'spottingId'] });
}

function voteWithdrawalToken(userId, voteDay, { id, spottingId }) {
  return createHmac('sha256', process.env.SECRET_SESSION)
    .update(`spot-vote-withdraw:${userId}:${voteDay}:${id}:${spottingId}`).digest('hex');
}

async function withdrawUnavailableVote(userId, voteDay, token) {
  const vote = await ownVoteFor(userId, voteDay);
  if (!vote) return;
  const expected = voteWithdrawalToken(userId, voteDay, vote);
  if (!timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) return;
  // The vote may move between reading it and deleting it.
  await db.spot_vote.destroy({ where: { userId, voteDay, id: vote.id, spottingId: vote.spottingId } });
}

async function ballot(recent, voteDay, now, userId) {
  const eligible = photoCandidates(recent, voteDay, now);
  const [totals, ownVote] = await Promise.all([
    eligible.length ? db.spot_vote.findAll({
      attributes: ['spottingId', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'votes']],
      where: { voteDay, spottingId: eligible.map(spot => spot.id) },
      group: ['spottingId'],
      raw: true
    }) : [],
    userId ? ownVoteFor(userId, voteDay) : null
  ]);
  const votesBySpot = new Map(totals.map(row => [row.spottingId, Number(row.votes)]));
  const top = Math.max(0, ...votesBySpot.values());
  const leaders = totals.filter(row => Number(row.votes) === top);
  const leadingId = leaders.length === 1 ? leaders[0].spottingId : null;
  const unavailableVote = ownVote && !eligible.some(spot => spot.id === ownVote.spottingId);
  return {
    hasVote: Boolean(ownVote),
    unavailableVoteToken: unavailableVote ? voteWithdrawalToken(userId, voteDay, ownVote) : null,
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
    const [recent, records] = await Promise.all([recentSightings({ includeFirstSpot: true }), getRecentRecords()]);
    res.render('activity', {
      spots: recent.map(spot => ({
        ...publicSighting(spot),
        firstSpot: Boolean(spot.get('isFirstRetained'))
      })),
      firstSpotBadge,
      carWhispererBadge,
      quizRecords: records.map(({ username, quizBest, quizBestAt }) => ({
        garageName: `@${username}`,
        garageUrl: `/u/${encodeURIComponent(username)}`,
        best: quizBest,
        carWhisperer: carWhispererBadge.test({ quizBest }),
        dateIso: utcDay(quizBestAt),
        dateLabel: dayLabel.format(quizBestAt)
      })),
      voteDay,
      ...await ballot(recent, voteDay, now, req.user?.id),
      pageTitle: 'Recent Sightings — AutoDex',
      pageDescription: 'See recent car sightings and photo quiz records from public AutoDex garages.',
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
  const { spottingId: input, day, action, withdrawalToken } = req.body;
  const spottingId = Number(input);
  const validSpotAction = ['vote', 'withdraw'].includes(action) && typeof input === 'string' &&
    /^[1-9]\d*$/.test(input) && spottingId <= 2147483647;
  const validUnavailableWithdrawal = action === 'withdraw-unavailable' && typeof withdrawalToken === 'string' &&
    /^[a-f0-9]{64}$/.test(withdrawalToken);
  if (!(validSpotAction || validUnavailableWithdrawal) || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return res.status(400).send('Choose a sighting and voting action.');
  }
  if (day !== voteDay) return res.status(409).send('Voting has reset. Reload the sightings page.');

  try {
    const userId = req.user.id;
    if (action === 'withdraw-unavailable') {
      await withdrawUnavailableVote(userId, voteDay, withdrawalToken);
    } else if (action === 'withdraw') {
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
        const recent = await recentSightings({ transaction });
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
