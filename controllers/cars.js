const express = require('express');
const router = express.Router();
const db = require('../models');
const rateLimit = require('express-rate-limit');
const isLoggedIn = require('../middleware/isLoggedIn');
const { upload } = require('../config/cloudinary');
const { isValidImageUrl } = require('../lib/validators');
const { cachedGet } = require('../lib/cache');
const { PLACEHOLDER_URL } = require('../lib/constants');

require('dotenv').config();

const baseURL = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
const endOfURL = '?format=json';

const PAGE_SIZE = 12;

// Mutating endpoints get their own limits — previously only auth routes were
// throttled, so a single logged-in user could spam favorites/proposals forever.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please slow down.'
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

// GET route for submitted form data from home route
router.get('/', async (req, res) => {
  let userQuery = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const { getModels } = require('../config/carquery');
    const cqModels = await getModels(userQuery.selectmake);

    // The list shown is the NHTSA model list, so paginate that first and only
    // fetch DB rows for the current page (previously the whole make was loaded
    // and sliced in JS).
    const total = cqModels.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pageModels = cqModels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const { Op } = require('sequelize');
    const dbCars = pageModels.length === 0 ? [] : await db.car.findAll({
      where: { make: userQuery.selectmake, model: { [Op.in]: pageModels.map(m => m.model) } }
    });
    const byModel = {};
    dbCars.forEach(c => { byModel[c.model] = c; });

    const pagedCars = pageModels.map(c => byModel[c.model] || {
      dataValues: {
        make: c.make,
        model: c.model,
        image: PLACEHOLDER_URL,
        favcount: 0
      }
    });
    const baseUrl = `/cars?selectmake=${encodeURIComponent(userQuery.selectmake)}&page=`;
    const viewData = { search: userQuery.selectmake, carImg: pagedCars, page, totalPages, total, baseUrl };
    if (req.query.partial === '1') {
      res.locals.layout = false;
      return res.render('partials/car-grid', viewData);
    }
    viewData.pageTitle = `${userQuery.selectmake} Models — AutoDex`;
    viewData.pageDescription = `Browse ${total} ${userQuery.selectmake} models on AutoDex.`;
    res.render('cars', viewData);
  } catch (err) {
    console.log('SEARCH ERROR:', err);
    res.status(500).send('Error fetching car data.');
  }
});

  // GET /cars/car?make=Toyota&model=Camry — individual car detail page
  router.get('/car', async (req, res) => {
    const { make, model } = req.query;
    if (!make || !model) return res.redirect('/');
    try {
      // Get this car from DB
      let car = await db.car.findOne({ where: { make, model } });
      // req.query.image comes from the link, so validate its scheme before rendering it
      const queryImage = isValidImageUrl(req.query.image) ? req.query.image.trim() : null;
      const image = queryImage || (car && car.image ? car.image : PLACEHOLDER_URL);
      const favcount = car ? car.favcount : 0;

      // Get other models from the same make (up to 6). Filtering in SQL means
      // the limit actually yields 6 rows (was: limit 7 then drop the current
      // model in JS, which returned only 5).
      const { Op } = require('sequelize');
      const related = await db.car.findAll({
        where: { make, model: { [Op.ne]: model } },
        limit: 6
      });
      const relatedCars = related.map(c => c.toJSON());

      // Wikipedia summary
      let wikiSummary = null;
      let wikiUrl = null;

      const wikiHeaders = { 'User-Agent': 'AutoDex/1.0 (https://github.com/lrakoto/auto-dex)' };

      // Helper: fetch summary for a known title (cached 24h — Wikipedia content
      // changes rarely and this ran on every single detail-page view)
      async function wikiByTitle(title) {
        try {
          const data = await cachedGet(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
            { timeout: 4000, headers: wikiHeaders }
          );
          if (data.type === 'standard' && data.extract) return data;
        } catch (e) {}
        return null;
      }

      // 1. Try direct title guesses
      const wikiTitles = [
        `${make} ${model}`,
        model,
        `${make} ${model.split(' ')[0]}`
      ];
      for (const title of wikiTitles) {
        const result = await wikiByTitle(title.replace(/\s+/g, '_'));
        if (result) {
          wikiSummary = result.extract;
          wikiUrl = result.content_urls?.desktop?.page || null;
          break;
        }
      }

      // 2. If nothing found, fall back to Wikipedia search API
      if (!wikiSummary) {
        try {
          const searchData = await cachedGet('https://en.wikipedia.org/w/api.php', {
            params: {
              action: 'opensearch',
              search: `${make} ${model} automobile`,
              limit: 3,
              format: 'json'
            },
            timeout: 4000,
            headers: wikiHeaders
          });
          const titles = searchData[1] || [];
          for (const title of titles) {
            const result = await wikiByTitle(title.replace(/\s+/g, '_'));
            if (result) {
              wikiSummary = result.extract;
              wikiUrl = result.content_urls?.desktop?.page || null;
              break;
            }
          }
        } catch (e) { /* non-critical */ }
      }

      // YouTube search links for media section
      const searchQuery = encodeURIComponent(`${make} ${model}`);
      const mediaLinks = [
        { label: 'Donut Media', icon: '🍩', url: `https://www.youtube.com/results?search_query=${searchQuery}+donut+media` },
        { label: 'MotorTrend', icon: '🏁', url: `https://www.youtube.com/results?search_query=${searchQuery}+motortrend` },
        { label: 'Top Gear',   icon: '🚗', url: `https://www.youtube.com/results?search_query=${searchQuery}+top+gear` },
        { label: 'Car and Driver', icon: '📰', url: `https://www.youtube.com/results?search_query=${searchQuery}+car+and+driver` },
        { label: 'Throttle House', icon: '🔥', url: `https://www.youtube.com/results?search_query=${searchQuery}+throttle+house` },
      ];

      // Pull manufacturer country from NHTSA (manufacturer list cached 24h —
      // it changes essentially never and was being re-fetched on every view)
      let country = null;
      try {
        const mfrList = await cachedGet(baseURL + 'getallmanufacturers' + endOfURL);
        if (mfrList && Array.isArray(mfrList.Results)) {
          const mfr = mfrList.Results.find(m =>
            m.Mfr_CommonName && m.Mfr_CommonName.toLowerCase() === make.toLowerCase()
          );
          if (mfr) country = mfr.Country;
        }
      } catch (e) { /* non-critical */ }

      // Car specs from FuelEconomy.gov (free, no key required).
      // Probe years in PARALLEL — sequentially this could block ~36s per view.
      let carSpecs = null;
      try {
        const fuelHeaders = { Accept: 'application/json' };
        const currentYear = new Date().getFullYear();
        const years = [];
        for (let y = currentYear; y >= currentYear - 8; y--) years.push(y);

        const probes = await Promise.allSettled(years.map(year =>
          cachedGet('https://www.fueleconomy.gov/ws/rest/vehicle/menu/options', {
            params: { year, make, model },
            headers: fuelHeaders,
            timeout: 4000
          })
        ));
        // Keep the newest year's hit (probes are in descending-year order)
        const hit = probes.find(r => r.status === 'fulfilled' && r.value.menuItem);
        if (hit) {
          const items = hit.value.menuItem;
          const vehicleId = (Array.isArray(items) ? items[0] : items).value;
          const d = await cachedGet(`https://www.fueleconomy.gov/ws/rest/vehicle/${vehicleId}`, {
            headers: fuelHeaders,
            timeout: 4000
          });
          carSpecs = {
            year:         d.year,
            type:         d.VClass,
            cylinders:    d.cylinders,
            displacement: d.displ,
            transmission: d.trany,
            drive:        d.drive,
            fuel:         d.fuelType1 || d.fuelType,
            cityMpg:      d.city08,
            hwyMpg:       d.highway08,
            combMpg:      d.comb08
          };
        }
      } catch (e) { /* non-critical */ }

      // Check if current user has this car in favorites
      let userFavorite = null;
      if (req.user) {
        userFavorite = await db.favorite_car.findOne({
          where: { userId: req.user.id, make, model }
        });
        if (userFavorite) userFavorite = userFavorite.toJSON();
      }

      res.render('cars/detail', {
        make, model, image, favcount, relatedCars, country, wikiSummary, wikiUrl, mediaLinks, carSpecs, userFavorite,
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
      const [favCar, carCreated] = await db.car.findOrCreate({
          where: {
              make: data.favecar_make,
              model: data.favecar_model,
          },
          defaults: {
              image: proposedImage || PLACEHOLDER_URL,
              favcount: 0,
              updated_img: false
          }
      });

      const [newFavCar, favCreated] = await db.favorite_car.findOrCreate({
          where: {
              carId: favCar.id,
              userId: req.user.id
          },
          defaults: {
              make: data.favecar_make,
              model: data.favecar_model,
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

      // Backfill image only if the car still has a placeholder image
      if (!carCreated && !favCar.updated_img && proposedImage) {
        await favCar.update({ image: proposedImage });
      }

      if (isAjax) { return res.json({ success: true, favId: newFavCar.id }); }
      return res.redirect('favorites');
    } catch (err) {
      console.log('FAV ERROR:', err);
      if (isAjax) { return res.status(500).json({ success: false, error: 'Could not add to favorites.' }); }
      req.flash('error', 'Could not add to favorites.');
      return res.redirect('/garage');
    }
  });

  // POST /cars/propose-image — user submits an image proposal for a car
  router.post('/propose-image', isLoggedIn, proposeLimiter, async (req, res) => {
    const carId = parseInt(req.body.carId, 10);
    const imageUrl = req.body.imageUrl;
    if (!Number.isInteger(carId) || !isValidImageUrl(imageUrl)) {
      req.flash('error', 'Please provide a valid http(s) image URL.');
      return res.redirect('back');
    }
    try {
      // Only propose against a car that actually exists, and only while it
      // still needs an image — otherwise proposals pile up for nothing.
      const car = await db.car.findByPk(carId);
      if (!car || car.updated_img) {
        req.flash('error', 'That car already has an image.');
        return res.redirect('back');
      }
      await db.image_proposal.create({
        carId,
        userId: req.user.id,
        imageUrl: imageUrl.trim(),
        status: 'pending'
      });
      req.flash('success', 'Image proposed — thanks! An admin will review it.');
    } catch (err) {
      console.log('PROPOSE ERROR:', err);
      req.flash('error', 'Could not submit proposal.');
    }
    res.redirect('back');
  });

  module.exports = router;