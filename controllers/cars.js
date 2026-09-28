const express = require('express');
const router = express.Router();
const db = require('../models');
const rateLimit = require('express-rate-limit');
const isLoggedIn = require('../middleware/isLoggedIn');
const { upload } = require('../config/cloudinary');
const { isValidImageUrl } = require('../lib/validators');
const { PLACEHOLDER_URL } = require('../lib/constants');
const carinfo = require('../lib/carinfo');
const carquery = require('../config/carquery'); // getModels via the module so tests can stub it
const { getMakeCountry } = carquery;
const { photoCredit } = require('../lib/unsplash');
const { getGallery, vote } = require('../lib/gallery');
const { findOrCreateCatalogCar, lookupMake, lookupCatalogCar } = require('../lib/catalog');
const { buildTimeline } = require('../lib/timeline');
const { getMakeProgress } = require('../lib/dex');

require('dotenv').config();

const PAGE_SIZE = 12;
const MAX_COMPARE = 3;

const carPath = (make, model) => `/cars/car?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;

function notFound(res) {
  return res.status(404).render('404', { pageTitle: 'Page Not Found — AutoDex', noindex: true });
}

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

// GET /cars/explore — cross-make browsing: decade, country, make, photos-only,
// sort. Decades use the NHTSA model years (jobs/years.js), so cars whose make
// hasn't been scanned yet only appear when no decade is picked.
const EXPLORE_SORTS = {
  popular: [['favcount', 'DESC'], ['year_max', 'DESC NULLS LAST'], ['model', 'ASC']],
  newest:  [['year_max', 'DESC NULLS LAST'], ['favcount', 'DESC']],
  oldest:  [['year_min', 'ASC NULLS LAST'], ['favcount', 'DESC']],
  az:      [['make', 'ASC'], ['model', 'ASC']]
};

router.get('/explore', async (req, res) => {
  const { Op } = require('sequelize');
  const { MAKES_LIST } = require('../config/carquery');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const str = v => (typeof v === 'string' ? v : '');
  const firstDecade = 1980;
  const lastDecade = Math.floor(new Date().getFullYear() / 10) * 10;
  const decades = [];
  for (let d = lastDecade; d >= firstDecade; d -= 10) decades.push(d);
  const countries = [...new Set(MAKES_LIST.map(getMakeCountry).filter(Boolean))].sort();

  const decade = decades.includes(parseInt(req.query.decade, 10)) ? parseInt(req.query.decade, 10) : null;
  const country = countries.includes(str(req.query.country)) ? str(req.query.country) : '';
  const make = MAKES_LIST.includes(str(req.query.make)) ? str(req.query.make) : '';
  const photos = req.query.photos === '1';
  const sort = EXPLORE_SORTS[req.query.sort] ? req.query.sort : 'popular';

  const where = {};
  const makes = MAKES_LIST.filter(m => (!make || m === make) && (!country || getMakeCountry(m) === country));
  where.make = { [Op.in]: makes };
  if (decade) {
    const span = [];
    for (let y = decade; y < decade + 10; y++) span.push(y);
    where.model_years = { [Op.overlap]: span };
  }
  if (photos) where.image = { [Op.ne]: PLACEHOLDER_URL };

  try {
    const { rows, count } = makes.length === 0 ? { rows: [], count: 0 } : await db.car.findAndCountAll({
      where,
      order: EXPLORE_SORTS[sort],
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    });
    rows.forEach(r => { r.dataValues.years = carinfo.formatYears(r); });

    const params = new URLSearchParams();
    if (decade) params.set('decade', decade);
    if (country) params.set('country', country);
    if (make) params.set('make', make);
    if (photos) params.set('photos', '1');
    if (sort !== 'popular') params.set('sort', sort);
    const qs = params.toString();
    const label = [decade ? decade + 's' : '', country, make].filter(Boolean).join(' ') || 'those filters';
    const viewData = {
      search: label,
      carImg: rows,
      page,
      total: count,
      totalPages: Math.ceil(count / PAGE_SIZE),
      baseUrl: `/cars/explore?${qs ? qs + '&' : ''}page=`
    };
    if (req.query.partial === '1') {
      res.locals.layout = false;
      return res.render('partials/car-grid', viewData);
    }
    Object.assign(viewData, {
      decades, countries, makesList: MAKES_LIST,
      filters: { decade, country, make, photos, sort },
      pageTitle: `Explore ${label === 'those filters' ? 'Cars' : label + ' Cars'} — AutoDex`,
      pageDescription: 'Browse cars across every make by decade, country of origin and popularity.',
      canonicalPath: '/cars/explore' + (qs ? '?' + qs : ''),
      // Filter combinations are endless; only the bare page is worth indexing
      noindex: !!qs || page > 1
    });
    res.render('cars/explore', viewData);
  } catch (err) {
    console.log('EXPLORE ERROR:', err);
    res.status(500).send('Error loading cars.');
  }
});

// GET /cars/timeline?make=Porsche — every dated model of a make on one year
// axis, from the NHTSA model years (jobs/years.js)
router.get('/timeline', async (req, res) => {
  const requested = typeof req.query.make === 'string' ? req.query.make.trim() : '';
  try {
    const make = await lookupMake(requested);
    if (!make) return notFound(res);
    if (make !== requested) return res.redirect(301, `/cars/timeline?make=${encodeURIComponent(make)}`);

    const { Op } = require('sequelize');
    const [listed, dated] = await Promise.all([
      carquery.getModels(make),
      db.car.findAll({ attributes: ['make', 'model', 'model_years'], where: { make, year_min: { [Op.ne]: null } } })
    ]);
    // Listed passenger models only (older rows can be motorcycles). An empty
    // list means NHTSA couldn't be reached, not that nothing is listed.
    const names = new Set(listed.map(m => m.model));
    const timeline = buildTimeline(names.size ? dated.filter(c => names.has(c.model)) : dated);

    res.render('cars/timeline', {
      make, timeline,
      country: getMakeCountry(make),
      carPath,
      pageTitle: `${make} Timeline — Every Model, Year by Year — AutoDex`,
      pageDescription: timeline
        ? `${timeline.rows.length} ${make} models on one timeline, ${timeline.start}–${timeline.end}: when each was built, the gaps, and what's still on sale.`
        : `The ${make} model timeline on AutoDex.`,
      canonicalPath: `/cars/timeline?make=${encodeURIComponent(make)}`,
      // Nothing to show until the year scan reaches this make
      noindex: !timeline
    });
  } catch (err) {
    console.log('TIMELINE ERROR:', err);
    res.status(500).send('Error loading timeline.');
  }
});

// GET /cars?selectmake=Toyota[&year=2005][&page=2] — models for a make
router.get('/', async (req, res) => {
  const requested = typeof req.query.selectmake === 'string' ? req.query.selectmake.trim() : '';
  if (!requested) return res.redirect('/makes');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const year = parseInt(req.query.year, 10) || null;
  try {
    const { Op } = require('sequelize');
    // Unknown makes 404 before anything asks NHTSA about them; other
    // spellings ("skoda", "TOYOTA") redirect to the catalog's
    const make = await lookupMake(requested);
    if (!make) return notFound(res);
    if (make !== requested) {
      return res.redirect(301, `/cars?selectmake=${encodeURIComponent(make)}${year ? '&year=' + year : ''}${page > 1 ? '&page=' + page : ''}`);
    }
    let cqModels = await carquery.getModels(make);

    // Year filter + dropdown come from the catalog's NHTSA model years
    // (jobs/years.js), for listed models only — rows seeded before the
    // vehicle-type filter include motorcycles, not yet classified.
    // Models with no year data drop out when a year is picked.
    const listed = new Set(cqModels.map(m => m.model));
    const dated = (await db.car.findAll({
      attributes: ['model', 'model_years', 'year_min', 'year_max'],
      where: { make, year_min: { [Op.ne]: null } }
    })).filter(c => listed.has(c.model));
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
    const { make: qMake, model: qModel } = req.query;
    if (typeof qMake !== 'string' || typeof qModel !== 'string' || !qMake || !qModel) return res.redirect('/');
    try {
      // Only catalog cars get a page — and the Wikipedia/Wikidata/FuelEconomy
      // lookups below, which cache whatever they're asked. Other spellings
      // ("toyota", "supra") redirect to the catalog's.
      const hit = await lookupCatalogCar(qMake, qModel);
      if (!hit) return notFound(res);
      const { make, model, car } = hit;
      if (make !== qMake || model !== qModel) return res.redirect(301, carPath(make, model));
      const favcount = car ? car.favcount : 0;
      const { Op } = require('sequelize');

      // External lookups and the viewer's state are independent — run them together
      const [related, wiki, carSpecs, favorite, mySpotCount, gallery] = await Promise.all([
        // Other models from the same make, the ones with photos first
        db.car.findAll({
          where: { make, model: { [Op.ne]: model } },
          order: [[db.sequelize.literal(`"car"."image" = ${db.sequelize.escape(PLACEHOLDER_URL)}`), 'ASC'], ['favcount', 'DESC']],
          limit: 6
        }),
        carinfo.getWikiSummary(make, model),
        carinfo.getFuelSpecs(make, model, car && car.year_max),
        req.user ? db.favorite_car.findOne({ where: { userId: req.user.id, make, model } }) : null,
        req.user && car ? db.spotting.count({ where: { userId: req.user.id, carId: car.id } }) : 0,
        car ? getGallery(car.id, req.user && req.user.id) : []
      ]);
      const relatedCars = related.map(c => c.toJSON());
      const userFavorite = favorite ? favorite.toJSON() : null;
      const country = getMakeCountry(make);
      const wikiFacts = wiki && wiki.wikidataId ? await carinfo.getWikidataFacts(wiki.wikidataId) : [];
      const wikiSummary = wiki ? wiki.summary : null;
      const wikiUrl = wiki ? wiki.url : null;

      // ?image= comes from the garage's favorite links. Honor it only when
      // it's the viewer's own favorite photo or already in this car's
      // gallery — otherwise anyone could dress the page in an arbitrary
      // picture. Share previews always use the catalog photo.
      const catalogImage = (car && car.image) || PLACEHOLDER_URL;
      const wanted = isValidImageUrl(req.query.image) ? req.query.image.trim() : null;
      const image = wanted && ((userFavorite && userFavorite.image === wanted) || gallery.some(g => g.url === wanted))
        ? wanted
        : catalogImage;

      // YouTube search links for media section
      const searchQuery = encodeURIComponent(`${make} ${model}`);
      const mediaLinks = [
        { label: 'Donut Media', icon: '🍩', url: `https://www.youtube.com/results?search_query=${searchQuery}+donut+media` },
        { label: 'MotorTrend', icon: '🏁', url: `https://www.youtube.com/results?search_query=${searchQuery}+motortrend` },
        { label: 'Top Gear',   icon: '🚗', url: `https://www.youtube.com/results?search_query=${searchQuery}+top+gear` },
        { label: 'Car and Driver', icon: '📰', url: `https://www.youtube.com/results?search_query=${searchQuery}+car+and+driver` },
        { label: 'Throttle House', icon: '🔥', url: `https://www.youtube.com/results?search_query=${searchQuery}+throttle+house` },
      ];

      gallery.forEach(img => { img.credit = photoCredit(img.url, img); });
      const heroImage = gallery.find(g => g.url === image);
      const heroCredit = photoCredit(image, heroImage);

      res.render('cars/detail', {
        make, model, image, favcount, relatedCars, country, wikiSummary, wikiUrl, wikiFacts, mediaLinks, carSpecs, userFavorite,
        gallery, mySpotCount, heroCredit,
        years: carinfo.formatYears(car),
        carDbId: car ? car.id : null,
        carUpdatedImg: car ? !!car.updated_img : false,
        pageTitle: `${make} ${model} — Specs, Images & Info — AutoDex`,
        pageDescription: wikiSummary ? wikiSummary.slice(0, 160) : `${make} ${model} specs, photos, and details on AutoDex.`,
        canonicalPath: carPath(make, model),
        ogTitle: make + ' ' + model + ' — AutoDex',
        ogDescription: wikiSummary ? wikiSummary.slice(0, 160) : make + ' ' + model + ' on AutoDex.',
        ogImage: catalogImage === PLACEHOLDER_URL ? null : catalogImage
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
      // Catalog cars only, in the catalog's spelling — crafted pairs get no
      // external lookups
      const hits = [];
      for (const hit of await Promise.all(pairs.map(p => lookupCatalogCar(p.make, p.model)))) {
        if (hit && !hits.some(h => h.make === hit.make && h.model === hit.model)) hits.push(hit);
      }
      const cars = await Promise.all(hits.map(async ({ make, model, car }) => {
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