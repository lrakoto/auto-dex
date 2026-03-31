require('dotenv').config();
const express = require('express');
const layouts = require('express-ejs-layouts');
const app = express();
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('./config/ppConfig');
const isLoggedIn = require('./middleware/isLoggedIn');
const isAdmin = require('./middleware/isAdmin');
const axios = require('axios');
const { application } = require('express');
const methodOverride = require('method-override');
const db = require('./models');

const SECRET_SESSION = process.env.SECRET_SESSION;

// For Car Data API calls
const CarAPIbaseURI = 'https://car-data.p.rapidapi.com';
const CarAPIKey = process.env.CKEY;
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

// Get data and pull into datbase
async function getCarData() {
  let carsArray = [];
  let pullCarMakesData = await axios.get(`${baseURL}${allMakes}${endOfURL}`)
  .catch(err => {console.log('INITIAL CAR API PULL ERROR:', err)})
  let pulledCarMakesData = pullCarMakesData.data.Results;
  pulledCarMakesData.forEach(async (carMake) => {
    let authenticate = true;
    if(
        // authenticate === true
        carMake.Country === 'UNITED STATES (USA)' 
        && carMake.Mfr_CommonName !== null 
        && carMake.Mfr_CommonName !== 'Daimler Trucks ' 
        && carMake.Mfr_CommonName !== 'Volvo (Truck / Bus)' 
        && carMake.Mfr_CommonName !== 'Navistar'
        && carMake.Mfr_CommonName !== 'Buel'
        && carMake.Mfr_CommonName !== 'Peterbilt'
      ) {
      let pullCarModelsData = await axios.get(`${baseURL}${allModelsByMake}${carMake.Mfr_CommonName.replaceAll(' ', '%20')}${endOfURL}`)
      .catch(err => {console.log('ANOTHER ERROR', err)})
      let pulledCarModelsData = pullCarModelsData.data.Results;
      console.log('BIG ERROR', pulledCarModelsData);

       pulledCarModelsData.forEach(carModel => {
        db.car.findOrCreate(
          {
          where: {
            make: `${carModel.Make_Name}`,
            model: `${carModel.Model_Name}`,
          }
        })
      })

      // UPDATE NULL IMAGE
      pulledCarModelsData.forEach(carModel => {
        db.car.update(
          {
            image: `https://i.ibb.co/PwkqdSy/placeholder.png`
          },
          {
          where: {
            make: `${carModel.Make_Name}`,
            model: `${carModel.Model_Name}`,
            image: null
          }
        })
      })

      // UPDATE FAVCOUNT
      pulledCarModelsData.forEach(carModel => {
        db.car.update(
          {
            favcount: 0
          },
          {
          where: {
            make: `${carModel.Make_Name}`,
            model: `${carModel.Model_Name}`,
            favcount: null
          }
        })
      })
    }
  })
}

 //getCarData(); // Already seeded — only uncomment to re-seed

// Get images from Unsplash API in increments of 50 per hour
const PRIORITY_MAKES = ['Tesla', 'Subaru', 'Mitsubishi', 'Chrysler', 'Nissan', 'Audi', 'Toyota', 'Mercedes-Benz'];

async function unsplashImages() {
  try {
    // First pass: priority makes. Second pass: everything else.
    let carimg = await db.car.findAll({
      where: { updated_img: false, make: PRIORITY_MAKES }
    });
    if (carimg.length === 0) {
      carimg = await db.car.findAll({ where: { updated_img: false } });
    }
    if (carimg.length === 0) {
      console.log('All images up to date.');
      return;
    }

    const batch = carimg.slice(0, 50);
    for (let car of batch) {
      let index = car.dataValues;
      try {
        let getCarImage = await axios.get(
          `${uSplashBaseURL}search/photos?orientation=landscape&page=1&per_page=1&query=${index.make.replaceAll(' ', '+')}+${index.model.replaceAll(' ', '+')}&${uSplashEnd}`
        );
        let results = getCarImage.data.results;
        let imgURL = results && results.length > 0
          ? results[0].urls.full
          : 'https://i.ibb.co/PwkqdSy/placeholder.png';
        await db.car.update(
          { updated_img: true, image: imgURL },
          { where: { make: index.make, model: index.model } }
        );
        console.log(`Image updated: ${index.make} ${index.model}`);
      } catch (err) {
        console.log(`UNSPLASH ERROR for ${index.make} ${index.model}:`, err.message);
        await db.car.update(
          { updated_img: true, image: 'https://i.ibb.co/PwkqdSy/placeholder.png' },
          { where: { make: index.make, model: index.model } }
        );
      }
    }
    console.log(`IMAGES ADDED: ${batch.length} processed`);
  } catch (err) {
    console.log('ERROR in unsplashImages:', err);
  }
}

setInterval(unsplashImages, 3700000);
unsplashImages(); // Run once on startup

app.set('view engine', 'ejs');

app.use(require('morgan')('dev'));
app.use(methodOverride('_method'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/public'));
app.use(layouts);

app.use(session({
  secret: SECRET_SESSION,
  resave: false,
  saveUninitialized: false
}));

app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  console.log('INJECT res locals --->>', res.locals);
  res.locals.alerts = req.flash();
  res.locals.currentUser = req.user;
  next();
});



// Save for future use
// OLD GET Route for Home and search form (Before pulling from tables, pulling directly from API)
app.get('/', (req, res) => {
  res.render('index');
});

// // OLD GET Route for Home and search form (Before pulling from tables, pulling directly from API)
// app.get('/', (req, res) => {
//   axios.get('https://vpic.nhtsa.dot.gov/api/vehicles/getallmanufacturers?format=json')
//   .then((response) => {
//     let sorted = [];
//     let data = response.data.Results;
//     data.forEach((make) => {
//       sorted.push(make.Mfr_CommonName);
//       sorted.sort();
//       console.log('SORTED:', sorted);
//     })
//     res.render('index', {data: data})
//   })
//   .catch((err) => {
//       console.log(err);
//   })
//   .finally(() => {
//       console.log('HOME ROUTE FOR SELECT FIELDS WORKED');
//   });
// });

// access to all of our auth routes GET /auth/login, GET /auth/signup POST routes
app.use('/auth', require('./controllers/auth'));
app.use('/cars', require('./controllers/cars'));
app.use('/garage', isLoggedIn, require('./controllers/garage'));

const carquery = require('./config/carquery');

async function getKnownMakes() {
  const makes = await carquery.getMakes();
  return makes.map(m => m.display);
}

// ── Trigram fuzzy helpers ──────────────────────────────────────────────────────
function makeTrigrams(s) {
  const set = new Set();
  for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
  return set;
}
function trigramSim(a, b) {
  const ta = makeTrigrams(a), tb = makeTrigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0; // too short for trigrams — skip
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  return (2 * inter) / (ta.size + tb.size);
}
function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 1;
  const words = t.split(/[\s\-]+/);
  return Math.max(trigramSim(q, t), ...words.map(w => trigramSim(q, w)));
}

// ── Autocomplete suggestions ──────────────────────────────────────────────────
app.get('/suggest', async (req, res) => {
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
        const makeCars = await db.car.findAll({
          where: { make: makePrefix },
          attributes: ['make', 'model', 'favcount'],
          order: [['favcount', 'DESC']]
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

    // Fuzzy DB pass
    if (models.length < 15) {
      const pool = await db.car.findAll({ attributes: ['make', 'model', 'favcount'], order: [['favcount', 'DESC']] });
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
app.get('/search', async (req, res) => {
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

app.get('/makes', async (req, res) => {
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

// 404 Handler
app.use((req, res, next) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🎧 You're listening to the smooth sounds of port ${PORT} 🎧`);
});

module.exports = server;
