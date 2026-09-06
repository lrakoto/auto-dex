const express = require('express');
const router = express.Router();
const db = require('../models');
const axios = require('axios');
const isLoggedIn = require('../middleware/isLoggedIn');
const { upload } = require('../config/cloudinary');
const { isValidImageUrl } = require('../lib/validators');

require('dotenv').config();

const baseURL = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
const allMakes = 'getallmanufacturers/';
const allModelsByMake = 'getmodelsformake/'; // needs model name
const endOfURL = '?format=json';

// Unsplash API Details
const uSplashKey = process.env.UKEY;
const uSplashSKey = process.env.USKEY;
const uSplashBaseURL = 'https://api.unsplash.com/';
const allManufacturers = 'getallmanufacturers';
const uSplashEnd = `client_id=${uSplashKey}`



const PAGE_SIZE = 12;

// Tiny in-memory TTL cache for slow-changing external API responses
const apiCache = new Map(); // url -> { at, data }
const API_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const API_CACHE_MAX = 500;
async function cachedGet(url) {
  const hit = apiCache.get(url);
  if (hit && Date.now() - hit.at < API_CACHE_TTL) return hit.data;
  const res = await axios.get(url, { timeout: 6000 });
  if (apiCache.size >= API_CACHE_MAX) apiCache.delete(apiCache.keys().next().value);
  apiCache.set(url, { at: Date.now(), data: res.data });
  return res.data;
}

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
    res.render('cars/search', { q, cars });
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

    // One DB round-trip for the whole make instead of one per model (was N+1)
    const dbCars = await db.car.findAll({ where: { make: userQuery.selectmake } });
    const byModel = {};
    dbCars.forEach(c => { byModel[c.model] = c; });

    const imgData = cqModels.map(c => byModel[c.model] || {
      dataValues: {
        make: c.make,
        model: c.model,
        image: 'https://i.ibb.co/PwkqdSy/placeholder.png',
        favcount: 0
      }
    });
    const total = imgData.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pagedCars = imgData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const baseUrl = `/cars?selectmake=${encodeURIComponent(userQuery.selectmake)}&page=`;
    const viewData = { search: userQuery.selectmake, carImg: pagedCars, page, totalPages, total, baseUrl };
    if (req.query.partial === '1') {
      res.locals.layout = false;
      return res.render('partials/car-grid', viewData);
    }
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
      const image = queryImage || (car ? car.image : 'https://i.ibb.co/PwkqdSy/placeholder.png');
      const favcount = car ? car.favcount : 0;

      // Get other models from the same make (up to 6, excluding current model)
      const related = await db.car.findAll({ where: { make }, limit: 7 });
      const relatedCars = related
        .map(c => c.toJSON())
        .filter(c => c.model !== model)
        .slice(0, 6);

      // Wikipedia summary
      let wikiSummary = null;
      let wikiUrl = null;

      const wikiHeaders = { 'User-Agent': 'AutoDex/1.0 (https://github.com/lrakoto/auto-dex)' };

      // Helper: fetch summary for a known title
      async function wikiByTitle(title) {
        try {
          const r = await axios.get(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
            { timeout: 4000, headers: wikiHeaders }
          );
          if (r.data.type === 'standard' && r.data.extract) return r.data;
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
          const searchRes = await axios.get('https://en.wikipedia.org/w/api.php', {
            params: {
              action: 'opensearch',
              search: `${make} ${model} automobile`,
              limit: 3,
              format: 'json'
            },
            timeout: 4000,
            headers: wikiHeaders
          });
          const titles = searchRes.data[1] || [];
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
          axios.get('https://www.fueleconomy.gov/ws/rest/vehicle/menu/options', {
            params: { year, make, model },
            headers: fuelHeaders,
            timeout: 4000
          })
        ));
        // Keep the newest year's hit (probes are in descending-year order)
        const hit = probes.find(r => r.status === 'fulfilled' && r.value.data.menuItem);
        if (hit) {
          const items = hit.value.data.menuItem;
          const vehicleId = (Array.isArray(items) ? items[0] : items).value;
          const specsRes = await axios.get(`https://www.fueleconomy.gov/ws/rest/vehicle/${vehicleId}`, {
            headers: fuelHeaders,
            timeout: 4000
          });
          const d = specsRes.data;
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
        // Keep favcount in sync — only decrement if a row was actually removed
        await db.car.decrement('favcount', { by: 1, where: { id: fav.carId } });
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
  router.post('/fav', isLoggedIn, async (req, res) => {
    const data = req.body;
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    try {
      const [favCar, carCreated] = await db.car.findOrCreate({
          where: {
              make: data.favecar_make,
              model: data.favecar_model,
          },
          defaults: {
              image: data.favecar_image || 'https://i.ibb.co/PwkqdSy/placeholder.png',
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
              image: data.favecar_image
          }
      });

      // Favorite already existed — nothing to count
      if (!favCreated) {
        console.log('ALREADY IN FAVORITES');
        if (isAjax) { return res.json({ success: true, favId: newFavCar.id, alreadyFavorited: true }); }
        return res.redirect('favorites');
      }

      // New favorite: atomic increment (no read-modify-write race)
      await db.car.increment('favcount', { by: 1, where: { id: favCar.id } });

      // Backfill image only if the car still has a placeholder image
      if (!carCreated && !favCar.updated_img && data.favecar_image) {
        await favCar.update({ image: data.favecar_image });
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
  router.post('/propose-image', isLoggedIn, async (req, res) => {
    const { carId, imageUrl } = req.body;
    if (!carId || !isValidImageUrl(imageUrl)) return res.redirect('back');
    try {
      await db.image_proposal.create({
        carId: parseInt(carId),
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

  // GET route cars/fav
  router.get('/fav', (req, res) => {
    let data = req.query;
    console.log('REQ QUERY', req.query);
    res.render('cars/fav', { favecar: data });
  });

//   // POST Route for add to favorites form on cars page
//   router.post('/fav', (req, res) => {
//     console.log('POST REQ BODY:', req.body);
//     console.log('POST RES BODY:', res.body);
//     // db.cars.findOrCreate(
//     //     where: { make: req.body.}
//     // )
//   });

  module.exports = router;