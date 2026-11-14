const express = require('express');
const db = require('../models');
const { RECENT_SPOTS } = require('../lib/dex');

const router = express.Router();
const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

router.get('/', async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    // Match the public garage's ordering and cap. The global window can't
    // surface a sighting beyond that garage's own recent list.
    const recent = await db.spotting.findAll({
      attributes: ['createdAt'],
      include: [
        {
          model: db.user,
          attributes: ['username'],
          where: { garagePublic: true, username: { [db.Sequelize.Op.ne]: '' } }
        },
        { model: db.car, attributes: ['make', 'model'], required: true }
      ],
      ...RECENT_SPOTS
    });
    const spots = recent.map(({ car, user, createdAt }) => ({
      make: car.make,
      model: car.model,
      carUrl: `/cars/car?make=${encodeURIComponent(car.make)}&model=${encodeURIComponent(car.model)}`,
      garageName: `@${user.username}`,
      garageUrl: `/u/${encodeURIComponent(user.username)}`,
      dateIso: createdAt.toISOString().slice(0, 10),
      dateLabel: dayLabel.format(createdAt)
    }));
    res.render('activity', {
      spots,
      pageTitle: 'Recent Sightings — AutoDex',
      pageDescription: 'See what AutoDex members have spotted in their public garages.',
      canonicalPath: '/activity',
      noindex: true
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
