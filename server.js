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
  axios.get('https://vpic.nhtsa.dot.gov/api/vehicles/getallmanufacturers?format=json')
  .then((response) => {
    let data = response.data.Results;
    data.sort((a, b) => {
      if (!a.Mfr_CommonName) return 1;
      if (!b.Mfr_CommonName) return -1;
      return a.Mfr_CommonName.localeCompare(b.Mfr_CommonName);
    });
    res.render('index', {data: data})
  })
  .catch((err) => {
      console.log(err);
  })
  .finally(() => {
      console.log('HOME ROUTE FOR SELECT FIELDS WORKED');
  });
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

app.get('/makes', async (req, res) => {
  try {
    const { Sequelize } = require('sequelize');
    const makes = await db.car.findAll({
      attributes: [
        'make',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'modelCount']
      ],
      group: ['make'],
      order: [['make', 'ASC']]
    });
    res.render('makes', { makes: makes.map(m => m.toJSON()) });
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
