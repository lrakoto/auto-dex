const express = require('express');
const router = express.Router();
const db = require('../models');
const carquery = require('../config/carquery');
const rateLimit = require('express-rate-limit');
const { fuzzyScore } = require('../lib/fuzzy');
const { getCarOfTheDay } = require('../lib/daily');

async function getKnownMakes() {
  const makes = await carquery.getMakes();
  return makes.map(m => m.display);
}

// The fuzzy pass needs a pool of the most-favorited cars. Loading it from the
// DB on every keystroke was wasteful (and the queries ordered by a column that
// had no index), so cache the pools briefly. Suggestions tolerate staleness.
const FUZZY_POOL_SIZE = 1000;      // global pool (no make prefix typed)
const FUZZY_MAKE_POOL_SIZE = 300;  // per-make pool ("Ferrari F…")
const FUZZY_POOL_TTL = 5 * 60 * 1000; // 5 minutes

let globalPool = { at: 0, cars: [] };
const makePools = new Map(); // make -> { at, cars }

async function getGlobalPool() {
  if (Date.now() - globalPool.at < FUZZY_POOL_TTL) return globalPool.cars;
  const rows = await db.car.findAll({
    attributes: ['make', 'model', 'favcount'],
    order: [['favcount', 'DESC']],
    limit: FUZZY_POOL_SIZE
  });
  globalPool = { at: Date.now(), cars: rows.map(c => c.toJSON()) };
  return globalPool.cars;
}

async function getMakePool(make) {
  const hit = makePools.get(make);
  if (hit && Date.now() - hit.at < FUZZY_POOL_TTL) return hit.cars;
  const rows = await db.car.findAll({
    where: { make },
    attributes: ['make', 'model', 'favcount'],
    order: [['favcount', 'DESC']],
    limit: FUZZY_MAKE_POOL_SIZE
  });
  const cars = rows.map(c => c.toJSON());
  makePools.set(make, { at: Date.now(), cars });
  return cars;
}

// The day's first pick can wait on NHTSA (lib/catalog.js#filterListed). The
// homepage doesn't: after this long it renders without the card, and the
// pick finishes in the background for the next visitor.
const COTD_WAIT_MS = 1500;

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(resolve, ms, fallback); })
  ]).finally(() => clearTimeout(timer));
}

router.get('/', async (req, res) => {
  // Non-critical: the homepage renders fine without it
  const cotd = await withTimeout(getCarOfTheDay().catch(err => {
    console.log('CAR OF THE DAY ERROR:', err.message);
    return null;
  }), COTD_WAIT_MS, null);
  res.render('index', {
    cotd,
    pageTitle: 'AutoDex — Car Database, Specs & Garage',
    pageDescription: 'Browse thousands of car makes and models, discover specs, save favorites, and build your personal garage.'
  });
});

// XML sitemap for crawlers — makes + the models we have real rows for.
// Capped so a large catalog can't produce an unbounded response.
const SITEMAP_MODEL_LIMIT = 5000;
router.get('/sitemap.xml', async (req, res) => {
  try {
    const siteUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const { Op } = require('sequelize');
    const [makes, cars, publicGarages, datedMakes, bikeMakes] = await Promise.all([
      getKnownMakes(),
      db.car.findAll({
        attributes: ['make', 'model', 'updatedAt'],
        order: [['favcount', 'DESC']],
        limit: SITEMAP_MODEL_LIMIT
      }),
      db.user.findAll({
        attributes: ['username'],
        where: { garagePublic: true, username: { [Op.ne]: null } },
        limit: SITEMAP_MODEL_LIMIT
      }),
      // Makes with a timeline to show
      db.car.findAll({ attributes: ['make'], where: { year_min: { [Op.ne]: null } }, group: ['make'] }),
      // Makes with a motorcycle listing
      db.car.findAll({ attributes: ['make'], where: { vehicle_type: 'motorcycle' }, group: ['make'] })
    ]);
    const timelineMakes = makes.filter(m => datedMakes.some(r => r.make === m));

    const urls = [
      { loc: '/', priority: '1.0' },
      { loc: '/makes', priority: '0.8' },
      { loc: '/cars/explore', priority: '0.6' },
      { loc: '/play', priority: '0.6' },
      // Motorcycle makes are listed once, at their canonical &type=motorcycle URL below
      ...makes.filter(m => !carquery.MOTORCYCLE_MAKES.includes(m))
        .map(m => ({ loc: `/cars?selectmake=${encodeURIComponent(m)}`, priority: '0.6' })),
      ...timelineMakes.map(m => ({ loc: `/cars/timeline?make=${encodeURIComponent(m)}`, priority: '0.5' })),
      ...makes.filter(m => bikeMakes.some(r => r.make === m))
        .map(m => ({ loc: `/cars?selectmake=${encodeURIComponent(m)}&type=motorcycle`, priority: '0.5' })),
      ...cars.map(c => ({
        loc: `/cars/car?make=${encodeURIComponent(c.make)}&model=${encodeURIComponent(c.model)}`,
        priority: '0.5',
        lastmod: c.updatedAt ? new Date(c.updatedAt).toISOString().slice(0, 10) : null
      })),
      ...publicGarages.map(u => ({ loc: `/u/${encodeURIComponent(u.username)}`, priority: '0.4' }))
    ];

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u =>
        '  <url><loc>' + siteUrl + u.loc.replace(/&/g, '&amp;') + '</loc>' +
        (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') +
        '<priority>' + u.priority + '</priority></url>'
      ).join('\n') +
      '\n</urlset>';

    res.type('application/xml').send(xml);
  } catch (err) {
    console.log('SITEMAP ERROR:', err);
    res.status(500).send('Could not generate sitemap.');
  }
});

// ── Autocomplete suggestions ──────────────────────────────────────────────────
// Hit per keystroke from the nav search — needs its own limiter
const suggestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/suggest', suggestLimiter, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ makes: [], models: [] });
  try {
    const { Op } = require('sequelize');
    const KNOWN_MAKES = await getKnownMakes();

    // Detect "Make ModelPrefix" pattern (e.g. "Ferrari F", "Honda Civ")
    const makePrefix = KNOWN_MAKES.find(m =>
      q.toLowerCase().startsWith(m.toLowerCase() + ' ')
    );
    if (makePrefix) {
      const modelQ = q.slice(makePrefix.length + 1).trim();
      const dbModels = await db.car.findAll({
        where: { make: makePrefix, model: { [Op.iLike]: '%' + modelQ + '%' } },
        attributes: ['make', 'model', 'favcount'],
        order: [['favcount', 'DESC']],
        limit: 15
      });
      let models = dbModels.map(c => c.toJSON());
      if (models.length < 15 && modelQ.length >= 2) {
        // Fuzzy pass against the cached per-make pool instead of a fresh
        // 300-row query on every keystroke.
        const pool = await getMakePool(makePrefix);
        const seen = new Set(models.map(c => c.make + '|' + c.model));
        const fuzzyHits = pool
          .map(car => ({ ...car, _score: fuzzyScore(modelQ, car.model) }))
          .filter(c => c._score > 0.45 && !seen.has(c.make + '|' + c.model))
          .sort((a, b) => b._score - a._score);
        models = models.concat(fuzzyHits.slice(0, 15 - models.length));
      }
      // Fall back to CarQuery if DB has nothing for this make
      if (models.length === 0) {
        const cqModels = await carquery.getModels(makePrefix);
        models = cqModels
          .filter(m => m.model.toLowerCase().includes(modelQ.toLowerCase()) || fuzzyScore(modelQ, m.model) > 0.45)
          .slice(0, 15);
      }
      return res.json({ makes: [], models: models.slice(0, 15) });
    }

    // Makes: exact substring first, then fuzzy
    const makes = KNOWN_MAKES
      .filter(m => fuzzyScore(q, m) > 0.3 || m.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => {
        const sa = a.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
        const sb = b.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
        return sb - sa;
      })
      .slice(0, 5);

    // Exact DB match
    let exactCars = await db.car.findAll({
      where: {
        [Op.or]: [
          { model: { [Op.iLike]: '%' + q + '%' } },
          { make:  { [Op.iLike]: '%' + q + '%' } }
        ]
      },
      attributes: ['make', 'model', 'favcount'],
      order: [['favcount', 'DESC']],
      limit: 15
    });
    let models = exactCars.map(c => c.toJSON());
    const seen = new Set(models.map(c => c.make + '|' + c.model));

    // Fuzzy DB pass — bounded to the most-favorited cars (cached briefly);
    // the previous version loaded 1000 rows from the DB on every keystroke.
    if (models.length < 15) {
      const pool = await getGlobalPool();
      const fuzzyHits = pool
        .map(car => ({ ...car, _score: Math.max(fuzzyScore(q, car.model), fuzzyScore(q, car.make + ' ' + car.model)) }))
        .filter(c => c._score > 0.45 && !seen.has(c.make + '|' + c.model))
        .sort((a, b) => b._score - a._score || (b.favcount || 0) - (a.favcount || 0));
      models = models.concat(fuzzyHits.slice(0, 15 - models.length));
    }

    // CarQuery fallback when DB has nothing
    if (models.length === 0 && makes.length > 0) {
      const cqModels = await carquery.getModels(makes[0]);
      models = cqModels.slice(0, 15);
    }

    res.json({ makes, models: models.slice(0, 15) });
  } catch (err) {
    res.json({ makes: [], models: [] });
  }
});

// ── Smart unified search ───────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.redirect('/');
  try {
    const { Op } = require('sequelize');
    const KNOWN_MAKES = await getKnownMakes();

    const makeMatch = KNOWN_MAKES.find(m => m.toLowerCase() === q.toLowerCase());
    if (makeMatch) return res.redirect('/cars?selectmake=' + encodeURIComponent(makeMatch));

    for (const make of KNOWN_MAKES) {
      if (q.toLowerCase().startsWith(make.toLowerCase() + ' ')) {
        const modelQ = q.slice(make.length + 1).trim();
        // Any case; an exact name beats a prefix, and a shorter prefix match
        // beats a longer one ("civic" → Civic, not Civic Type R)
        const { fn, col, literal } = db.Sequelize;
        const match = await db.car.findOne({
          where: { make, model: { [Op.iLike]: modelQ.replace(/[\\%_]/g, '\\$&') + '%' } },
          order: [
            [literal(`lower("car"."model") = ${db.sequelize.escape(modelQ.toLowerCase())}`), 'DESC'],
            [fn('length', col('model')), 'ASC'],
            ['favcount', 'DESC']
          ]
        });
        if (match) return res.redirect('/cars/car?make=' + encodeURIComponent(match.make) + '&model=' + encodeURIComponent(match.model));
        return res.redirect('/cars?selectmake=' + encodeURIComponent(make));
      }
    }

    return res.redirect('/cars/search?q=' + encodeURIComponent(q));
  } catch (err) {
    return res.redirect('/cars/search?q=' + encodeURIComponent(q));
  }
});

// GET /makes — manufacturers on three shelves: cars (the curated car makes,
// plus any other make whose catalog rows are mostly cars), motorcycles (every
// make with motorcycles, Honda and BMW included), and trucks, buses and more
router.get('/makes', async (req, res) => {
  try {
    const { fn, col } = db.Sequelize;
    const rows = await db.car.findAll({
      attributes: ['make', 'vehicle_type', [fn('COUNT', col('id')), 'n']],
      group: ['make', 'vehicle_type'],
      raw: true
    });
    // make -> { car, motorcycle, offroad, commercial }; unclassified rows count as cars
    const counts = {};
    rows.forEach(r => {
      const c = counts[r.make] || (counts[r.make] = {});
      const t = r.vehicle_type || 'car';
      c[t] = (c[t] || 0) + parseInt(r.n, 10);
    });

    const carMakes = new Set(carquery.MAKES_LIST);
    const bikeMakes = new Set(carquery.MOTORCYCLE_MAKES);
    const shelves = [
      { id: 'cars', title: 'Cars', makes: [] },
      { id: 'motorcycles', title: 'Motorcycles', makes: [] },
      { id: 'more', title: 'Trucks, buses and more', makes: [] }
    ];
    const plural = (n, word) => (n ? `${n.toLocaleString('en-US')} ${word}` : 'Browse');
    for (const make of new Set([...carquery.ALL_MAKES, ...Object.keys(counts)])) {
      const c = counts[make] || {};
      const [primary] = Object.entries(c).sort((a, b) => b[1] - a[1])[0] || ['car'];
      const href = `/cars?selectmake=${encodeURIComponent(make)}`;
      if (carMakes.has(make) || (!bikeMakes.has(make) && primary === 'car')) {
        shelves[0].makes.push({ make, label: plural(c.car, 'models'), href });
      }
      if (bikeMakes.has(make) || c.motorcycle) {
        shelves[1].makes.push({ make, label: plural(c.motorcycle, 'motorcycles'), href: href + '&type=motorcycle' });
      }
      if (!carMakes.has(make) && !bikeMakes.has(make) && primary !== 'car' && primary !== 'motorcycle') {
        const total = Object.values(c).reduce((a, b) => a + b, 0);
        shelves[2].makes.push({ make, label: plural(total, 'vehicles'), href });
      }
    }
    shelves.forEach(sh => sh.makes.sort((a, b) => a.make.localeCompare(b.make)));

    res.render('makes', {
      shelves,
      pageTitle: 'Browse Car and Motorcycle Manufacturers — AutoDex',
      pageDescription: `Browse ${shelves[0].makes.length} car makers and ${shelves[1].makes.length} motorcycle makers and their models on AutoDex.`
    });
  } catch (err) {
    console.log('MAKES ERROR:', err);
    res.redirect('/');
  }
});

module.exports = router;
