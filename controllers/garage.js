const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../models');
const { upload } = require('../config/cloudinary');
const isAdmin = require('../middleware/isAdmin');
const { isValidImageUrl } = require('../lib/validators');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { decodeVin, getRecalls, normalizeVin } = require('../lib/nhtsa');
const { addImage, refreshHero } = require('../lib/gallery');
const { getDexStats, getBadges } = require('../lib/dex');
const { validateUsername } = require('../lib/usernames');

// Mutating garage/admin routes were previously unlimited.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.'
});

// VIN decode and recall checks proxy NHTSA — keep a lid on them
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lookups. Please slow down.' }
});

const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many admin actions. Please slow down.'
});

// ─── GARAGE (user profile page) ───────────────────────────────────────────────

// GET /garage — profile/garage page: My Cars, Dex, Favorites, settings
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const [myCars, favorites, dex, recentSpots] = await Promise.all([
      db.user_car.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      db.favorite_car.findAll({ where: { userId } }),
      getDexStats(userId),
      db.spotting.findAll({
        where: { userId },
        include: [{ model: db.car, attributes: ['make', 'model', 'image'] }],
        order: [['createdAt', 'DESC']],
        limit: 12
      })
    ]);
    const badges = await getBadges(userId, dex);
    res.render('garage/index', {
      myCars: myCars.map(c => c.toJSON()),
      favorites: favorites.map(f => f.toJSON()),
      dex, badges,
      recentSpots: recentSpots.map(s => s.toJSON()),
      pageTitle: 'My Garage — AutoDex',
      canonicalPath: '/garage',
      noindex: true
    });
  } catch (err) {
    console.log('GARAGE ERROR:', err);
    res.status(500).send('Error loading garage.');
  }
});

// POST /garage/settings — public garage handle + visibility
router.post('/settings', writeLimiter, async (req, res) => {
  try {
    const wantsPublic = req.body.garagePublic === 'on';
    const rawName = (req.body.username || '').trim();
    const updates = { garagePublic: wantsPublic };
    if (rawName) {
      const check = validateUsername(rawName);
      if (!check.ok) {
        req.flash('error', check.error);
        return res.redirect('/garage#settings');
      }
      const taken = await db.user.count({ where: { username: check.username, id: { [db.Sequelize.Op.ne]: req.user.id } } });
      if (taken) {
        req.flash('error', 'That username is taken.');
        return res.redirect('/garage#settings');
      }
      updates.username = check.username;
    } else {
      updates.username = null;
    }
    if (updates.garagePublic && !updates.username) {
      req.flash('error', 'Pick a username before making your garage public.');
      return res.redirect('/garage#settings');
    }
    await db.user.update(updates, { where: { id: req.user.id } });
    req.flash('success', updates.garagePublic
      ? `Your garage is public at /u/${updates.username}`
      : 'Garage settings saved. Your garage is private.');
  } catch (err) {
    console.log('SETTINGS ERROR:', err);
    req.flash('error', 'Could not save settings.');
  }
  res.redirect('/garage#settings');
});

// DELETE /garage/spot/:id — remove one of your own spots
router.delete('/spot/:id', writeLimiter, async (req, res) => {
  try {
    await db.spotting.destroy({ where: { id: req.params.id, userId: req.user.id } });
  } catch (err) {
    console.log('DELETE SPOT ERROR:', err);
  }
  res.redirect('/garage#dex');
});

// ─── CASCADING DROPDOWN API ENDPOINTS ─────────────────────────────────────────

// GET /garage/makes — returns all makes as JSON for the add-car dropdown
router.get('/makes', async (req, res) => {
  try {
    const { getMakes } = require('../config/carquery');
    const makes = await getMakes();
    res.json(makes.map(m => m.display));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch makes' });
  }
});

// GET /garage/models?make=Toyota — returns models for a make
router.get('/models', async (req, res) => {
  try {
    const make = req.query.make;
    if (!make) return res.status(400).json({ error: 'make is required' });
    const { getModels } = require('../config/carquery');
    const models = await getModels(make);
    res.json(models.map(m => m.model));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// GET /garage/years?make=Toyota&model=Camry — model years for a make+model.
// Uses the catalog's NHTSA model years when jobs/years.js has filled them in,
// otherwise falls back to every year since 1980.
router.get('/years', async (req, res) => {
  const { make, model } = req.query;
  if (!make || !model) return res.status(400).json({ error: 'make and model are required' });
  try {
    const car = await db.car.findOne({ where: { make, model }, attributes: ['model_years'] });
    if (car && car.model_years && car.model_years.length) {
      return res.json([...car.model_years].sort((a, b) => b - a).map(String));
    }
  } catch (err) { /* fall back to the full range */ }
  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 1980; y--) years.push(String(y));
  res.json(years);
});

// GET /garage/vin?vin=1HGCM82633A004352 — decode a VIN for the add-car form
router.get('/vin', lookupLimiter, async (req, res) => {
  if (!normalizeVin(req.query.vin)) {
    return res.status(400).json({ error: 'A VIN is 17 letters and numbers (no I, O or Q).' });
  }
  try {
    const decoded = await decodeVin(req.query.vin);
    if (!decoded) return res.status(404).json({ error: "NHTSA couldn't decode that VIN." });
    res.json(decoded);
  } catch (err) {
    console.log('VIN ERROR:', err.message);
    res.status(502).json({ error: 'VIN lookup is unavailable right now.' });
  }
});

// ─── ADD CAR ──────────────────────────────────────────────────────────────────

// GET /garage/add — show add-car form
router.get('/add', (req, res) => {
  res.render('garage/add-car', {
    pageTitle: 'Add a Car — AutoDex',
    canonicalPath: '/garage/add'
  });
});

// POST /garage/add — create a user car (handles both URL and file upload)
router.post('/add', writeLimiter, upload.single('carImage'), async (req, res) => {
  try {
    const { make, model, year, imageUrl, notes } = req.body;
    let image = PLACEHOLDER_URL;
    let vin = null;
    if (req.body.vin && req.body.vin.trim()) {
      vin = normalizeVin(req.body.vin);
      if (!vin) {
        req.flash('error', 'That VIN doesn\'t look right — 17 letters and numbers, no I, O or Q.');
        return res.redirect('/garage/add');
      }
    }

    if (req.file) {
      image = req.file.path; // Cloudinary URL
    } else if (imageUrl && imageUrl.trim() !== '') {
      if (!isValidImageUrl(imageUrl)) {
        req.flash('error', 'Image URL must start with http(s)://');
        return res.redirect('/garage/add');
      }
      image = imageUrl.trim();
    }

    await db.user_car.create({
      userId: req.user.id,
      make,
      model,
      year,
      image,
      notes: notes || null,
      vin
    });

    req.flash('success', `${make} ${model} added to your garage!`);
    res.redirect('/garage');
  } catch (err) {
    console.log('ADD CAR ERROR:', err);
    req.flash('error', 'Failed to add car. Please try again.');
    res.redirect('/garage/add');
  }
});

// Load a garage car owned by the current user, or null
function findOwnCar(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return Promise.resolve(null);
  return db.user_car.findOne({ where: { id, userId: req.user.id } });
}

// GET /garage/car/:id — one garage car: recalls + maintenance log
router.get('/car/:id', async (req, res) => {
  try {
    const car = await findOwnCar(req);
    if (!car) return res.status(404).render('404', { pageTitle: 'Page Not Found — AutoDex', noindex: true });
    const logs = await db.maintenance_log.findAll({
      where: { userCarId: car.id },
      order: [['date', 'DESC'], ['id', 'DESC']]
    });
    let recalls = null; // null = couldn't check; [] = none
    try {
      recalls = await getRecalls(car.make, car.model, car.year);
    } catch (err) {
      console.log('RECALLS ERROR:', err.message);
    }
    const totalCost = logs.reduce((sum, l) => sum + (l.cost ? parseFloat(l.cost) : 0), 0);
    res.render('garage/car', {
      car: car.toJSON(),
      logs: logs.map(l => l.toJSON()),
      recalls,
      totalCost,
      today: new Date().toISOString().slice(0, 10),
      pageTitle: `${car.year} ${car.make} ${car.model} — My Garage — AutoDex`,
      canonicalPath: `/garage/car/${car.id}`,
      noindex: true
    });
  } catch (err) {
    console.log('GARAGE CAR ERROR:', err);
    res.status(500).send('Error loading car.');
  }
});

// GET /garage/car/:id/recalls — recall count for the garage card badges
router.get('/car/:id/recalls', lookupLimiter, async (req, res) => {
  try {
    const car = await findOwnCar(req);
    if (!car) return res.status(404).json({ error: 'not found' });
    const recalls = await getRecalls(car.make, car.model, car.year);
    res.json({ count: recalls.length });
  } catch (err) {
    res.status(502).json({ error: 'unavailable' });
  }
});

// POST /garage/car/:id/maintenance — add a log entry
router.post('/car/:id/maintenance', writeLimiter, async (req, res) => {
  const back = `/garage/car/${encodeURIComponent(req.params.id)}#maintenance`;
  try {
    const car = await findOwnCar(req);
    if (!car) return res.redirect('/garage');
    const { date, title, mileage, cost, notes } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !title || !title.trim()) {
      req.flash('error', 'A date and a description are required.');
      return res.redirect(back);
    }
    const num = v => (v === undefined || v === null || String(v).trim() === '' ? null : Number(String(v).replace(/[,$\s]/g, '')));
    const miles = num(mileage);
    const dollars = num(cost);
    if ((miles !== null && (!Number.isInteger(miles) || miles < 0)) || (dollars !== null && (!Number.isFinite(dollars) || dollars < 0))) {
      req.flash('error', 'Mileage and cost must be positive numbers.');
      return res.redirect(back);
    }
    await db.maintenance_log.create({
      userCarId: car.id,
      date,
      title: title.trim().slice(0, 120),
      mileage: miles,
      cost: dollars,
      notes: notes && notes.trim() ? notes.trim().slice(0, 2000) : null
    });
    req.flash('success', 'Maintenance logged.');
  } catch (err) {
    console.log('MAINTENANCE ERROR:', err);
    req.flash('error', 'Could not save that entry.');
  }
  res.redirect(back);
});

// DELETE /garage/car/:id/maintenance/:logId
router.delete('/car/:id/maintenance/:logId', writeLimiter, async (req, res) => {
  try {
    const car = await findOwnCar(req);
    if (car) await db.maintenance_log.destroy({ where: { id: req.params.logId, userCarId: car.id } });
  } catch (err) {
    console.log('DELETE MAINTENANCE ERROR:', err);
  }
  res.redirect(`/garage/car/${encodeURIComponent(req.params.id)}#maintenance`);
});

// PUT /garage/car/:id — update a user car's image and/or notes
router.put('/car/:id', writeLimiter, upload.single('carImage'), async (req, res) => {
  try {
    const updates = {};
    if (req.file) {
      updates.image = req.file.path;
    } else if (req.body.imageUrl && req.body.imageUrl.trim()) {
      if (!isValidImageUrl(req.body.imageUrl)) {
        req.flash('error', 'Image URL must start with http(s)://');
        return res.redirect('/garage');
      }
      updates.image = req.body.imageUrl.trim();
    }
    if (req.body.notes !== undefined) updates.notes = req.body.notes || null;
    await db.user_car.update(updates, { where: { id: req.params.id, userId: req.user.id } });
    res.redirect('/garage');
  } catch (err) {
    console.log('EDIT CAR ERROR:', err);
    res.redirect('/garage');
  }
});

// DELETE /garage/car/:id — remove a user car
router.delete('/car/:id', writeLimiter, async (req, res) => {
  try {
    await db.user_car.destroy({
      where: { id: req.params.id, userId: req.user.id }
    });
    res.redirect('/garage');
  } catch (err) {
    console.log('DELETE CAR ERROR:', err);
    res.redirect('/garage');
  }
});

// ─── ADMIN IMAGE MANAGEMENT ───────────────────────────────────────────────────

// GET /garage/admin — view all cars with placeholder images + pending proposals
router.get('/admin', isAdmin, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const cars = await db.car.findAll({
      where: {
        image: {
          [Op.or]: [null, PLACEHOLDER_URL]
        }
      },
      order: [['make', 'ASC'], ['model', 'ASC']],
      limit: 100
    });
    const unverifiedUsers = await db.user.findAll({
      where: { emailVerified: false },
      attributes: ['id', 'name', 'email', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });

    const allUsers = await db.user.findAll({
      attributes: ['id', 'name', 'email', 'isAdmin', 'emailVerified', 'createdAt', 'lastLoginAt'],
      order: [['createdAt', 'DESC']]
    });

    // Attach activity counts
    const userIds = allUsers.map(u => u.id);
    const [totalCars, unsplashRemaining, favCounts, garageCounts, proposalCounts] = await Promise.all([
      db.car.count(),
      db.car.count({ where: { [Op.or]: [{ image: null }, { image: PLACEHOLDER_URL }] } }),
      db.favorite_car.findAll({ where: { userId: userIds }, attributes: ['userId', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']], group: ['userId'] }),
      db.user_car.findAll({ where: { userId: userIds }, attributes: ['userId', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']], group: ['userId'] }),
      db.image_proposal.findAll({ where: { userId: userIds }, attributes: ['userId', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']], group: ['userId'] })
    ]);
    const toMap = rows => { const m = {}; rows.forEach(r => { m[r.userId] = parseInt(r.getDataValue('count')); }); return m; };
    const favMap = toMap(favCounts), garageMap = toMap(garageCounts), proposalMap = toMap(proposalCounts);

    const usersWithActivity = allUsers.map(u => ({
      ...u.toJSON(),
      favorites: favMap[u.id] || 0,
      garageCars: garageMap[u.id] || 0,
      proposals: proposalMap[u.id] || 0
    }));
    const proposals = await db.image_proposal.findAll({
      where: { status: 'pending' },
      include: [
        { model: db.car,  attributes: ['id', 'make', 'model', 'image'] },
        { model: db.user, attributes: ['id', 'name', 'email'] }
      ],
      order: [['createdAt', 'ASC']]
    });
    res.render('garage/admin', {
      pageTitle: 'Admin — AutoDex',
      canonicalPath: '/garage/admin',
      cars: cars.map(c => c.toJSON()),
      proposals: proposals.map(p => p.toJSON()),
      unverifiedUsers: unverifiedUsers.map(u => u.toJSON()),
      allUsers: usersWithActivity,
      totalCars,
      unsplashRemaining
    });
  } catch (err) {
    console.log('ADMIN ERROR:', err);
    res.status(500).send('Error loading admin page.');
  }
});

// POST /garage/admin/verify-user/:id — manually verify a user's email
router.post('/admin/verify-user/:id', isAdmin, adminWriteLimiter, async (req, res) => {
  try {
    await db.user.update(
      { emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null },
      { where: { id: req.params.id } }
    );
    req.flash('success', 'User verified.');
  } catch (err) {
    console.log('VERIFY USER ERROR:', err);
    req.flash('error', 'Failed to verify user.');
  }
  res.redirect('/garage/admin');
});

// POST /garage/admin/proposal/:id/approve
router.post('/admin/proposal/:id/approve', isAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const proposal = await db.image_proposal.findByPk(req.params.id);
    if (!proposal) return res.redirect('/garage/admin');
    // Joins the gallery; becomes the hero right away only if the car had none
    await addImage(proposal.carId, proposal.imageUrl, { userId: proposal.userId, source: 'user' });
    await proposal.update({ status: 'approved' });
    req.flash('success', 'Photo approved and added to the gallery.');
  } catch (err) {
    console.log('APPROVE ERROR:', err);
    req.flash('error', 'Failed to approve.');
  }
  res.redirect('/garage/admin');
});

// POST /garage/admin/proposal/:id/reject
router.post('/admin/proposal/:id/reject', isAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const proposal = await db.image_proposal.findByPk(req.params.id);
    if (proposal) await proposal.update({ status: 'rejected' });
    req.flash('success', 'Proposal rejected.');
  } catch (err) {
    console.log('REJECT ERROR:', err);
  }
  res.redirect('/garage/admin');
});

// POST /garage/admin/reset-unsplash-queue — reset updated_img for placeholder cars so Unsplash retries them
router.post('/admin/reset-unsplash-queue', isAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const [count] = await db.car.update(
      { updated_img: false },
      { where: { [Op.or]: [{ image: null }, { image: PLACEHOLDER_URL }] } }
    );
    req.flash('success', `Queue reset — ${count} cars will be retried on the next Unsplash run.`);
  } catch (err) {
    console.log('RESET QUEUE ERROR:', err);
    req.flash('error', 'Failed to reset queue.');
  }
  res.redirect('/garage/admin');
});

// PUT /garage/admin/car/:id — update a car's default image
router.put('/admin/car/:id', isAdmin, adminWriteLimiter, upload.single('carImage'), async (req, res) => {
  try {
    const { imageUrl } = req.body;
    let image;

    if (req.file) {
      image = req.file.path;
    } else if (imageUrl && imageUrl.trim() !== '') {
      if (!isValidImageUrl(imageUrl)) {
        req.flash('error', 'Image URL must start with http(s)://');
        return res.redirect('/garage/admin');
      }
      image = imageUrl.trim();
    } else {
      req.flash('error', 'Please provide an image URL or upload a file.');
      return res.redirect('/garage/admin');
    }

    // Admin override: joins the gallery and becomes the hero immediately
    await addImage(parseInt(req.params.id, 10), image, { userId: req.user.id, source: 'admin', makeHero: true });

    req.flash('success', 'Car image updated.');
    res.redirect('/garage/admin');
  } catch (err) {
    console.log('ADMIN UPDATE ERROR:', err);
    req.flash('error', 'Failed to update image.');
    res.redirect('/garage/admin');
  }
});

// DELETE /garage/admin/image/:id — remove a gallery image (wrong car, spam…)
router.delete('/admin/image/:id', isAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const image = await db.car_image.findByPk(req.params.id, { include: [{ model: db.car, attributes: ['make', 'model'] }] });
    if (image) {
      await image.destroy();
      const hero = await refreshHero(image.carId);
      // Last image gone: back to the placeholder. updated_img stays true so the
      // Unsplash job doesn't just re-fetch the same bad result.
      if (!hero) await db.car.update({ image: PLACEHOLDER_URL, updated_img: true }, { where: { id: image.carId } });
      req.flash('success', 'Image removed from the gallery.');
      if (image.car) return res.redirect(`/cars/car?make=${encodeURIComponent(image.car.make)}&model=${encodeURIComponent(image.car.model)}`);
    }
  } catch (err) {
    console.log('REMOVE IMAGE ERROR:', err);
    req.flash('error', 'Could not remove that image.');
  }
  res.redirect('/garage/admin');
});

module.exports = router;
