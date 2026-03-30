const express = require('express');
const router = express.Router();
const db = require('../models');
const axios = require('axios');
const { cloudinary, upload } = require('../config/cloudinary');
const isAdmin = require('../middleware/isAdmin');

const baseURL = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
const endOfURL = '?format=json';

// ─── GARAGE (user profile page) ───────────────────────────────────────────────

// GET /garage — profile/garage page
router.get('/', async (req, res) => {
  try {
    const myCars = await db.user_car.findAll({ where: { userId: req.user.id } });
    const favorites = await db.favorite_car.findAll({ where: { userId: req.user.id } });
    res.render('garage/index', {
      myCars: myCars.map(c => c.toJSON()),
      favorites: favorites.map(f => f.toJSON())
    });
  } catch (err) {
    console.log('GARAGE ERROR:', err);
    res.status(500).send('Error loading garage.');
  }
});

// ─── CASCADING DROPDOWN API ENDPOINTS ─────────────────────────────────────────

// GET /garage/makes — returns all makes as JSON for the add-car dropdown
router.get('/makes', async (req, res) => {
  try {
    const response = await axios.get(`${baseURL}getallmanufacturers${endOfURL}`);
    const makes = response.data.Results
      .filter(m => m.Mfr_CommonName && m.Country === 'UNITED STATES (USA)')
      .map(m => m.Mfr_CommonName)
      .filter((v, i, a) => a.indexOf(v) === i) // dedupe
      .sort();
    res.json(makes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch makes' });
  }
});

// GET /garage/models?make=Toyota — returns models for a make
router.get('/models', async (req, res) => {
  try {
    const make = req.query.make;
    if (!make) return res.status(400).json({ error: 'make is required' });
    const response = await axios.get(`${baseURL}getmodelsformake/${encodeURIComponent(make)}${endOfURL}`);
    const models = response.data.Results
      .map(m => m.Model_Name)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// GET /garage/years?make=Toyota&model=Camry — returns years for a make+model
router.get('/years', async (req, res) => {
  try {
    const { make, model } = req.query;
    if (!make || !model) return res.status(400).json({ error: 'make and model are required' });
    const response = await axios.get(
      `${baseURL}getmodelsformakeyear/make/${encodeURIComponent(make)}/modelyear/1990${endOfURL}`
    );
    // NHTSA doesn't have a great "years for model" endpoint, so we build a reasonable range
    const currentYear = new Date().getFullYear() + 1;
    const years = [];
    for (let y = currentYear; y >= 1980; y--) years.push(String(y));
    res.json(years);
  } catch (err) {
    // Fallback: return year range even on error
    const currentYear = new Date().getFullYear() + 1;
    const years = [];
    for (let y = currentYear; y >= 1980; y--) years.push(String(y));
    res.json(years);
  }
});

// ─── ADD CAR ──────────────────────────────────────────────────────────────────

// GET /garage/add — show add-car form
router.get('/add', (req, res) => {
  res.render('garage/add-car');
});

// POST /garage/add — create a user car (handles both URL and file upload)
router.post('/add', upload.single('carImage'), async (req, res) => {
  try {
    const { make, model, year, imageUrl, notes } = req.body;
    let image = 'https://i.ibb.co/PwkqdSy/placeholder.png';

    if (req.file) {
      image = req.file.path; // Cloudinary URL
    } else if (imageUrl && imageUrl.trim() !== '') {
      image = imageUrl.trim();
    }

    await db.user_car.create({
      userId: req.user.id,
      make,
      model,
      year,
      image,
      notes: notes || null
    });

    req.flash('success', `${make} ${model} added to your garage!`);
    res.redirect('/garage');
  } catch (err) {
    console.log('ADD CAR ERROR:', err);
    req.flash('error', 'Failed to add car. Please try again.');
    res.redirect('/garage/add');
  }
});

// PUT /garage/car/:id — update a user car's image and/or notes
router.put('/car/:id', upload.single('carImage'), async (req, res) => {
  try {
    const updates = {};
    if (req.file) {
      updates.image = req.file.path;
    } else if (req.body.imageUrl && req.body.imageUrl.trim()) {
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
router.delete('/car/:id', async (req, res) => {
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
          [Op.or]: [null, 'https://i.ibb.co/PwkqdSy/placeholder.png']
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
    const proposals = await db.image_proposal.findAll({
      where: { status: 'pending' },
      include: [
        { model: db.car,  attributes: ['id', 'make', 'model', 'image'] },
        { model: db.user, attributes: ['id', 'name', 'email'] }
      ],
      order: [['createdAt', 'ASC']]
    });
    res.render('garage/admin', {
      cars: cars.map(c => c.toJSON()),
      proposals: proposals.map(p => p.toJSON()),
      unverifiedUsers: unverifiedUsers.map(u => u.toJSON())
    });
  } catch (err) {
    console.log('ADMIN ERROR:', err);
    res.status(500).send('Error loading admin page.');
  }
});

// POST /garage/admin/verify-user/:id — manually verify a user's email
router.post('/admin/verify-user/:id', isAdmin, async (req, res) => {
  try {
    await db.user.update(
      { emailVerified: true, verificationToken: null },
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
router.post('/admin/proposal/:id/approve', isAdmin, async (req, res) => {
  try {
    const proposal = await db.image_proposal.findByPk(req.params.id);
    if (!proposal) return res.redirect('/garage/admin');
    await db.car.update(
      { image: proposal.imageUrl, updated_img: true },
      { where: { id: proposal.carId } }
    );
    await proposal.update({ status: 'approved' });
    req.flash('success', 'Image approved and applied.');
  } catch (err) {
    console.log('APPROVE ERROR:', err);
    req.flash('error', 'Failed to approve.');
  }
  res.redirect('/garage/admin');
});

// POST /garage/admin/proposal/:id/reject
router.post('/admin/proposal/:id/reject', isAdmin, async (req, res) => {
  try {
    const proposal = await db.image_proposal.findByPk(req.params.id);
    if (proposal) await proposal.update({ status: 'rejected' });
    req.flash('success', 'Proposal rejected.');
  } catch (err) {
    console.log('REJECT ERROR:', err);
  }
  res.redirect('/garage/admin');
});

// PUT /garage/admin/car/:id — update a car's default image
router.put('/admin/car/:id', isAdmin, upload.single('carImage'), async (req, res) => {
  try {
    const { imageUrl } = req.body;
    let image;

    if (req.file) {
      image = req.file.path;
    } else if (imageUrl && imageUrl.trim() !== '') {
      image = imageUrl.trim();
    } else {
      req.flash('error', 'Please provide an image URL or upload a file.');
      return res.redirect('/garage/admin');
    }

    await db.car.update(
      { image, updated_img: true },
      { where: { id: req.params.id } }
    );

    req.flash('success', 'Car image updated.');
    res.redirect('/garage/admin');
  } catch (err) {
    console.log('ADMIN UPDATE ERROR:', err);
    req.flash('error', 'Failed to update image.');
    res.redirect('/garage/admin');
  }
});

module.exports = router;
