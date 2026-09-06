const express = require('express');
const router = express.Router();
const db = require('../models');
const carquery = require('../config/carquery');
const rateLimit = require('express-rate-limit');
const { fuzzyScore } = require('../lib/fuzzy');

async function getKnownMakes() {
  const makes = await carquery.getMakes();
  return makes.map(m => m.display);
}

router.get('/', (req, res) => {
  res.render('index');
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
      let dbModels = await db.car.findAll({
        where: { make: makePrefix, model: { [Op.iLike]: '%' + modelQ + '%' } },
        attributes: ['make', 'model', 'favcount'],
        order: [['favcount', 'DESC']],
        limit: 15
      });
      let models = dbModels.map(c => c.toJSON());
      if (models.length < 15 && modelQ.length >= 2) {
        // Bounded pool — fuzzy-scoring one make's most-favorited cars is cheap
        const makeCars = await db.car.findAll({
          where: { make: makePrefix },
          attributes: ['make', 'model', 'favcount'],
          order: [['favcount', 'DESC']],
          limit: 300
        });
        const seen = new Set(models.map(c => c.make + '|' + c.model));
        const fuzzyHits = makeCars
          .map(c => { const car = c.toJSON(); return { ...car, _score: fuzzyScore(modelQ, car.model) }; })
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

    // Fuzzy DB pass — bounded to the most-favorited cars; the previous
    // version loaded the ENTIRE cars table into memory on every keystroke
    if (models.length < 15) {
      const pool = await db.car.findAll({ attributes: ['make', 'model', 'favcount'], order: [['favcount', 'DESC']], limit: 1000 });
      const fuzzyHits = pool
        .map(c => { const car = c.toJSON(); return { ...car, _score: Math.max(fuzzyScore(q, car.model), fuzzyScore(q, car.make + ' ' + car.model)) }; })
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
        const exact = await db.car.findOne({
          where: { make, model: { [Op.like]: modelQ + '%' } },
          order: [['favcount', 'DESC']]
        });
        if (exact) return res.redirect('/cars/car?make=' + encodeURIComponent(exact.make) + '&model=' + encodeURIComponent(exact.model));
        return res.redirect('/cars?selectmake=' + encodeURIComponent(make));
      }
    }

    return res.redirect('/cars/search?q=' + encodeURIComponent(q));
  } catch (err) {
    return res.redirect('/cars/search?q=' + encodeURIComponent(q));
  }
});

router.get('/makes', async (req, res) => {
  try {
    const [dbMakes, cqMakes] = await Promise.all([
      db.car.findAll({
        attributes: ['make', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'modelCount']],
        group: ['make']
      }),
      carquery.getMakes()
    ]);
    const countMap = {};
    dbMakes.forEach(m => { countMap[m.make] = parseInt(m.getDataValue('modelCount')); });

    // Union of CarQuery makes + any DB makes not already included
    const allNames = new Set(cqMakes.map(m => m.display));
    Object.keys(countMap).forEach(m => allNames.add(m));
    const makes = Array.from(allNames).sort((a, b) => a.localeCompare(b)).map(name => ({
      make: name,
      modelCount: countMap[name] != null ? countMap[name] : null
    }));

    res.render('makes', { makes });
  } catch (err) {
    console.log('MAKES ERROR:', err);
    res.redirect('/');
  }
});

module.exports = router;
