// Public garage pages: /u/:username. Only rendered when the owner has chosen
// a username AND turned garagePublic on; everything else is a plain 404 so
// private garages can't be probed for.
const express = require('express');
const router = express.Router();
const db = require('../models');
const { getDexStats, getBadges } = require('../lib/dex');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { favoritePhoto } = require('../lib/photos');

function notFound(res) {
  return res.status(404).render('404', { pageTitle: 'Page Not Found — AutoDex', noindex: true });
}

router.get('/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').toLowerCase();
    const owner = await db.user.findOne({
      where: { username, garagePublic: true },
      attributes: ['id', 'name', 'username', 'createdAt', 'quizBest']
    });
    if (!owner) return notFound(res);

    const [myCars, favorites, dex, recentSpots] = await Promise.all([
      db.user_car.findAll({
        where: { userId: owner.id },
        // Public view: no VINs, no notes
        attributes: ['id', 'make', 'model', 'year', 'image'],
        order: [['createdAt', 'DESC']]
      }),
      db.favorite_car.findAll({
        where: { userId: owner.id },
        attributes: ['make', 'model', 'image'],
        include: [{ model: db.car, attributes: ['image'] }]
      }),
      getDexStats(owner.id),
      db.spotting.findAll({
        where: { userId: owner.id },
        attributes: ['id', 'imageUrl', 'createdAt'],
        include: [{ model: db.car, attributes: ['make', 'model', 'image'] }],
        order: [['createdAt', 'DESC']],
        limit: 12
      })
    ]);
    const badges = (await getBadges(owner.id, dex)).filter(b => b.earned);

    const cars = myCars.map(c => c.toJSON());
    const favs = favorites.map(f => ({ make: f.make, model: f.model, photo: favoritePhoto(f) }));
    const shareImage = [...cars.map(c => c.image), ...favs.map(f => f.photo)]
      .find(url => url && url !== PLACEHOLDER_URL);
    const displayName = owner.name || owner.username;
    const summary = `${cars.length} car${cars.length === 1 ? '' : 's'} in the garage, ${dex.spottedCars} spotted across ${dex.spottedMakes} make${dex.spottedMakes === 1 ? '' : 's'}.`;

    res.render('profile', {
      owner: owner.toJSON(),
      displayName,
      myCars: cars,
      favorites: favs,
      dex, badges,
      recentSpots: recentSpots.map(s => s.toJSON()),
      pageTitle: `${displayName}'s Garage — AutoDex`,
      pageDescription: summary,
      canonicalPath: `/u/${owner.username}`,
      ogTitle: `${displayName}'s Garage on AutoDex`,
      ogDescription: summary,
      ogImage: shareImage || null
    });
  } catch (err) {
    console.log('PROFILE ERROR:', err);
    res.status(500).send('Error loading garage.');
  }
});

module.exports = router;
