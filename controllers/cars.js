const express = require('express');
const router = express.Router();
const db = require('../models');
const rateLimit = require('express-rate-limit');
const isLoggedIn = require('../middleware/isLoggedIn');
const { upload } = require('../config/cloudinary');
const { isValidImageUrl } = require('../lib/validators');
const { PLACEHOLDER_URL } = require('../lib/constants');
const carinfo = require('../lib/carinfo');
const { getMakeCountry } = require('../config/carquery');
const { getGallery, vote } = require('../lib/gallery');
const { findOrCreateCatalogCar } = require('../lib/catalog');
const { getMakeProgress } = require('../lib/dex');

require('dotenv').config();

const PAGE_SIZE = 12;
const MAX_COMPARE = 3;

// Mutating endpoints get their own limits — previously only auth routes were
// throttled, so a single logged-in user could spam favorites/proposals forever.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.'
});

const spotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many spots in an hour. Take a breather!'
});

const proposeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many image proposals. Please try again later.'
});

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.redirect('/');
  try {
    const { Op } = require('sequelize');
    const results = await db.car.findAll({
      where: {
        [Op.or]: [
          { model: { [Op.iLike]: '%' + q + '%' } },
          { make: { [Op.iLike]: '%' + q + '%' } }
        ]
      },
      limit: 48,
      order: [['favcount', 'DESC']]
    });
    const cars = results.map(r => r.toJSON());
    res.render('cars/search', {
      q, cars,
      pageTitle: `Search: ${q} — AutoDex`,
      pageDescription: `${cars.length} result${cars.length === 1 ? '' : 's'} for "${q}" on AutoDex.`
    });
  } catch (err) {
    console.log('MODEL SEARCH ERROR:', err);
    res.redirect('/');
  }
});

// GET /cars?selectmake=Toyota[&year=2005][&page=2] — models for a make
router.get('/', async (req, res) => {
  const make = typeof req.query.selectmake === 'string' ? req.query.selectmake : '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const year = parseInt(req.query.year, 10) || null;
  try {
    const { Op } = require('sequelize');
    const { getModels } = require('../config/carquery');
    let cqModels = await getModels(make);

    // Year filter + dropdown come from the catalog's NHTSA model years
    // (jobs/years.js). Models with no year data drop out when a year is picked.
    const dated = await db.car.findAll({
      attributes: ['model', 'model_years', 'year_min', 'year_max'],
      where: { make, year_min: { [Op.ne]: null } }
    });
    const allYears = new Set();
    dated.forEach(c => (c.model_years || []).forEach(y => allYears.add(y)));
    const yearOptions = [...allYears].sort((a, b) => b - a);
    if (year) {
      const inYear = new Set(dated.filter(c => (c.model_years || []).includes(year)).map(c => c.model));
      cqModels = cqModels.filter(m => inYear.has(m.model));
    }

    // Paginate the NHTSA model list first, then fetch DB rows for this page only
    const total = cqModels.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pageModels = cqModels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const dbCars = pageModels.length === 0 ? [] : await db.car.findAll({
      where: { make, model: { [Op.in]: pageModels.map(m => m.model) } }
    });
    const byModel = {};
    dbCars.forEach(c => { byModel[c.model] = c; });

    const pagedCars = pageModels.map(c => {
      const row = byModel[c.model];
      if (row) {
        row.dataValues.years = carinfo.formatYears(row);
        return row;
      }
      return { dataValues: { make: c.make, model: c.model, image: PLACEHOLDER_URL, favcount: 0, years: null } };
    });
    const baseUrl = `/cars?selectmake=${encodeURIComponent(make)}${year ? '&year=' + year : ''}&page=`;
    const viewData = { search: make, carImg: pagedCars, page, totalPages, total, baseUrl };
    if (req.query.partial === '1') {
      res.locals.layout = false;
      return res.render('partials/car-grid', viewData);
    }

    // Dex progress for logged-in users: distinct models of this make spotted
    let dexProgress = null;
    if (req.user) {
      const catalogTotal = await db.car.count({ where: { make } });
      if (catalogTotal) dexProgress = { spotted: await getMakeProgress(req.user.id, make), total: catalogTotal };
    }

    Object.assign(viewData, {
      year, yearOptions, dexProgress,
      // Each make is its own page to search engines (req.path alone made
      // every make canonicalize to /cars). Year filters point at the make.
      canonicalPath: `/cars?selectmake=${encodeURIComponent(make)}${page > 1 && !year ? '&page=' + page : ''}`,
      pageTitle: `${make} Models${year ? ' (' + year + ')' : ''} — AutoDex`,
      pageDescription: `Browse ${total} ${make} models${year ? ' from ' + year : ''} on AutoDex.`
    });
    res.render('cars', viewData);
  } catch (err) {
    console.log('SEARCH ERROR:', err);
    res.status(500).send('Error fetching car data.');
  }
});

  // GET /cars/car?make=Toyota&model=Camry — individual car detail page
  router.get('/car', async (req, res) => {
    const { make, model } = req.query;
    if (typeof make !== 'string' || typeof model !== 'string' || !make || !model) return res.redirect('/');
    try {
      // Get this car from DB
      const car = await db.car.findOne({ where: { make, model } });
      // req.query.image comes from the link, so validate its scheme before rendering it
      const queryImage = isValidImageUrl(req.query.image) ? req.query.image.trim() : null;
      const image = queryImage || (car && car.image ? car.image : PLACEHOLDER_URL);
      const favcount = car ? car.favcount : 0;

      // Other models from the same make (up to 6), filtered in SQL
      const { Op } = require('sequelize');
      const related = await db.car.findAll({
        where: { make, model: { [Op.ne]: model } },
        limit: 6
      });
      const relatedCars = related.map(c => c.toJSON());

      // External lookups are independent — run them in parallel
      const [wiki, country, carSpecs] = await Promise.all([
        carinfo.getWikiSummary(make, model),
        Promise.resolve(getMakeCountry(make)),
        carinfo.getFuelSpecs(make, model, car && car.year_max)
      ]);
      const wikiFacts = wiki && wiki.wikidataId ? await carinfo.getWikidataFacts(wiki.wikidataId) : [];
      const wikiSummary = wiki ? wiki.summary : null;
      const wikiUrl = wiki ? wiki.url : null;

      // YouTube search links for media section
      const searchQuery = encodeURIComponent(`${make} ${model}`);
      const mediaLinks = [
        { label: 'Donut Media', icon: '🍩', url: `https://www.youtube.com/results?search_query=${searchQuery}+donut+media` },
        { label: 'MotorTrend', icon: '🏁', url: `https://www.youtube.com/results?search_query=${searchQuery}+motortrend` },
        { label: 'Top Gear',   icon: '🚗', url: `https://www.youtube.com/results?search_query=${searchQuery}+top+gear` },
        { label: 'Car and Driver', icon: '📰', url: `https://www.youtube.com/results?search_query=${searchQuery}+car+and+driver` },
        { label: 'Throttle House', icon: '🔥', url: `https://www.youtube.com/results?search_query=${searchQuery}+throttle+house` },
      ];

      // Viewer-specific state: favorite, gallery votes, spot count
      let userFavorite = null;
      let mySpotCount = 0;
      if (req.user) {
        userFavorite = await db.favorite_car.findOne({
          where: { userId: req.user.id, make, model }
        });
        if (userFavorite) userFavorite = userFavorite.toJSON();
        if (car) mySpotCount = await db.spotting.count({ where: { userId: req.user.id, carId: car.id } });
      }
      const gallery = car ? await getGallery(car.id, req.user && req.user.id) : [];

      res.render('cars/detail', {
        make, model, image, favcount, relatedCars, country, wikiSummary, wikiUrl, wikiFacts, mediaLinks, carSpecs, userFavorite,
        gallery, mySpotCount,
        years: carinfo.formatYears(car),
        carDbId: car ? car.id : null,
        carUpdatedImg: car ? !!car.updated_img : false,
        pageTitle: `${make} ${model} — Specs, Images & Info — AutoDex`,
        pageDescription: wikiSummary ? wikiSummary.slice(0, 160) : `${make} ${model} specs, photos, and details on AutoDex.`,
        canonicalPath: `/cars/car?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`,
        ogTitle: make + ' ' + model + ' — AutoDex',
        ogDescription: wikiSummary ? wikiSummary.slice(0, 160) : make + ' ' + model + ' on AutoDex.',
        ogImage: image
      });
    } catch (err) {
      console.log('CAR DETAIL ERROR:', err);
      res.status(500).send('Error loading car details.');
    }
  });

  // GET /cars/compare?c=Toyota|Supra&c=Nissan|Skyline — side-by-side, up to 3
  router.get('/compare', async (req, res) => {
    const raw = [].concat(req.query.c || []).filter(v => typeof v === 'string');
    const pairs = [];
    for (const v of raw) {
      const i = v.indexOf('|');
      if (i <= 0 || i === v.length - 1) continue;
      const pair = { make: v.slice(0, i), model: v.slice(i + 1) };
      if (!pairs.some(p => p.make === pair.make && p.model === pair.model)) pairs.push(pair);
      if (pairs.length === MAX_COMPARE) break;
    }
    try {
      const cars = await Promise.all(pairs.map(async ({ make, model }) => {
        const car = await db.car.findOne({ where: { make, model } });
        const [wiki, carSpecs] = await Promise.all([
          carinfo.getWikiSummary(make, model),
          carinfo.getFuelSpecs(make, model, car && car.year_max)
        ]);
        const facts = wiki && wiki.wikidataId ? await carinfo.getWikidataFacts(wiki.wikidataId) : [];
        const factMap = {};
        facts.forEach(f => { factMap[f.label] = f.values.join(', '); });
        return {
          make, model,
          image: car && car.image ? car.image : PLACEHOLDER_URL,
          favcount: car ? car.favcount : 0,
          years: carinfo.formatYears(car),
          specs: carSpecs,
          facts: factMap
        };
      }));
      // Only show fact rows at least one car actually has
      const factLabels = [...new Set(cars.flatMap(c => Object.keys(c.facts)))];
      res.render('cars/compare', {
        cars, factLabels,
        pageTitle: cars.length
          ? `Compare ${cars.map(c => c.make + ' ' + c.model).join(' vs ')} — AutoDex`
          : 'Compare Cars — AutoDex',
        pageDescription: 'Side-by-side specs, years and facts for up to three cars.',
        canonicalPath: '/cars/compare',
        noindex: true
      });
    } catch (err) {
      console.log('COMPARE ERROR:', err);
      res.status(500).send('Error loading comparison.');
    }
  });

  // POST /cars/spot — "Spotted it!" check-in (optional photo, location, notes)
  router.post('/spot', isLoggedIn, spotLimiter, upload.single('spotImage'), async (req, res) => {
    const { make, model } = req.body;
    const back = `/cars/car?make=${encodeURIComponent(make || '')}&model=${encodeURIComponent(model || '')}`;
    try {
      let imageUrl = null;
      if (req.file) {
        imageUrl = req.file.path;
      } else if (req.body.imageUrl && req.body.imageUrl.trim()) {
        if (!isValidImageUrl(req.body.imageUrl)) {
          req.flash('error', 'Photo URL must start with http(s)://');
          return res.redirect(back);
        }
        imageUrl = req.body.imageUrl.trim();
      }
      const car = await findOrCreateCatalogCar(make, model);
      if (!car) {
        req.flash('error', "We couldn't find that car in the catalog.");
        return res.redirect('/');
      }
      const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
      await db.spotting.create({
        userId: req.user.id,
        carId: car.id,
        imageUrl,
        location: clip(req.body.location, 120),
        notes: clip(req.body.notes, 1000)
      });
      req.flash('success', `Spotted: ${car.make} ${car.model}! It's in your Dex.`);
    } catch (err) {
      console.log('SPOT ERROR:', err);
      req.flash('error', 'Could not save that spot.');
    }
    res.redirect(back);
  });

  // POST /cars/images/:id/vote — value=1 | -1 | 0 (clear). AJAX returns JSON.
  router.post('/images/:id/vote', isLoggedIn, writeLimiter, async (req, res) => {
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    const imageId = parseInt(req.params.id, 10);
    const value = parseInt(req.body.value, 10);
    if (!Number.isInteger(imageId) || ![-1, 0, 1].includes(value)) {
      return isAjax ? res.status(400).json({ success: false }) : res.redirect('back');
    }
    try {
      const result = await vote(imageId, req.user.id, value);
      if (!result) return isAjax ? res.status(404).json({ success: false }) : res.redirect('back');
      if (isAjax) return res.json({ success: true, ...result });
    } catch (err) {
      console.log('VOTE ERROR:', err);
      if (isAjax) return res.status(500).json({ success: false });
      req.flash('error', 'Could not record your vote.');
    }
    res.redirect('back');
  });

  // GET /favorites → redirect to garage
  router.get('/favorites/', isLoggedIn, (req, res) => res.redirect('/garage'));

  // DELETE ROUTE for /favorites
  router.delete('/favorites/delete/:id', isLoggedIn, async (req, res) => {
    try {
      const fav = await db.favorite_car.findOne({ where: { id: req.params.id, userId: req.user.id } });
      if (fav) {
        await fav.destroy();
        // Keep favcount in sync, clamped at zero — a plain decrement could
        // otherwise drive it negative if counts ever drifted.
        await db.sequelize.query(
          'UPDATE cars SET "favcount" = GREATEST(COALESCE("favcount", 0) - 1, 0) WHERE id = :id',
          { replacements: { id: fav.carId } }
        );
      }
      if (req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.json({ success: true });
      }
      res.redirect('/garage');
    } catch (error1) {
      console.log('DELETE ERROR:', error1);
      if (req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.status(500).json({ success: false });
      }
      res.redirect('/garage');
    }
  })

  // PUT Route for /favorites/:id — handles URL or file upload
  router.put('/favorites/edit/:id', isLoggedIn, upload.single('newimage'), async (req, res) => {
    try {
      let imageUrl;
      if (req.file) {
        imageUrl = req.file.path;
      } else if (isValidImageUrl(req.body.newimagelink)) {
        imageUrl = req.body.newimagelink.trim();
      } else {
        req.flash('error', 'Please provide a valid http(s) image URL or upload a file.');
        return res.redirect('/garage');
      }
      await db.favorite_car.update(
        { image: imageUrl },
        { where: { id: req.params.id, userId: req.user.id } }
      );
      res.redirect('/garage');
    } catch (err) {
      console.log('PUT ERROR:', err);
      res.redirect('/garage');
    }
  })

  // POST route cars/fav
  router.post('/fav', isLoggedIn, writeLimiter, async (req, res) => {
    const data = req.body;
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    // The image arrives in the request body, so it is untrusted — validate the
    // scheme and reject characters that could break out of HTML/CSS contexts.
    const proposedImage = isValidImageUrl(data.favecar_image) ? data.favecar_image.trim() : null;
    try {
      // Only real catalog cars (NHTSA-listed or already in the DB) — this used
      // to findOrCreate whatever make/model the form posted
      const favCar = await findOrCreateCatalogCar(data.favecar_make, data.favecar_model);
      if (!favCar) {
        if (isAjax) { return res.status(404).json({ success: false, error: "We couldn't find that car." }); }
        req.flash('error', "We couldn't find that car.");
        return res.redirect('/garage');
      }

      const [newFavCar, favCreated] = await db.favorite_car.findOrCreate({
          where: {
              carId: favCar.id,
              userId: req.user.id
          },
          defaults: {
              make: favCar.make,
              model: favCar.model,
              image: proposedImage
          }
      });

      // Favorite already existed — nothing to count
      if (!favCreated) {
        if (isAjax) { return res.json({ success: true, favId: newFavCar.id, alreadyFavorited: true }); }
        return res.redirect('favorites');
      }

      // New favorite: atomic increment (no read-modify-write race)
      await db.car.increment('favcount', { by: 1, where: { id: favCar.id } });

      // (The posted image only decorates the user's own favorite row. It used
      // to backfill the catalog hero too, which let any form post set a
      // placeholder car's cover — covers now go through the moderated gallery.)

      if (isAjax) { return res.json({ success: true, favId: newFavCar.id }); }
      return res.redirect('favorites');
    } catch (err) {
      console.log('FAV ERROR:', err);
      if (isAjax) { return res.status(500).json({ success: false, error: 'Could not add to favorites.' }); }
      req.flash('error', 'Could not add to favorites.');
      return res.redirect('/garage');
    }
  });

  // POST /cars/propose-image — user submits a photo for a car's gallery.
  // Any car qualifies (approved photos join the gallery and compete on votes);
  // cars without a DB row yet are resolved by make/model.
  router.post('/propose-image', isLoggedIn, proposeLimiter, async (req, res) => {
    const carId = parseInt(req.body.carId, 10);
    const imageUrl = req.body.imageUrl;
    if (!isValidImageUrl(imageUrl)) {
      req.flash('error', 'Please provide a valid http(s) image URL.');
      return res.redirect('back');
    }
    try {
      const car = Number.isInteger(carId)
        ? await db.car.findByPk(carId)
        : await findOrCreateCatalogCar(req.body.make, req.body.model);
      if (!car) {
        req.flash('error', "We couldn't find that car.");
        return res.redirect('back');
      }
      const url = imageUrl.trim();
      const [inGallery, alreadyProposed] = await Promise.all([
        db.car_image.count({ where: { carId: car.id, url } }),
        db.image_proposal.count({ where: { carId: car.id, imageUrl: url, status: 'pending' } })
      ]);
      if (inGallery || alreadyProposed) {
        req.flash('error', 'That photo is already in the gallery or waiting for review.');
        return res.redirect('back');
      }
      await db.image_proposal.create({
        carId: car.id,
        userId: req.user.id,
        imageUrl: url,
        status: 'pending'
      });
      req.flash('success', 'Photo submitted — thanks! An admin will review it.');
    } catch (err) {
      console.log('PROPOSE ERROR:', err);
      req.flash('error', 'Could not submit proposal.');
    }
    res.redirect('back');
  });

  module.exports = router;