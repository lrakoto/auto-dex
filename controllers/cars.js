const express = require('express');
const router = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const axios = require('axios');
const isLoggedIn = require('../middleware/isLoggedIn');
const app = express();
const methodOverride = require('method-override');

require('dotenv').config();
const layouts = require('express-ejs-layouts');
const session = require('express-session');
const flash = require('connect-flash');
const { application, request } = require('express');
const car = require('../models/car');

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



const PAGE_SIZE = 12;

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.redirect('/');
  try {
    const { Op } = require('sequelize');
    const results = await db.car.findAll({
      where: { model: { [Op.like]: '%' + q + '%' } },
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
    let response = await axios.get(`${baseURL}${allModelsByMake}${userQuery.selectmake}${endOfURL}`);
    let data = response.data.Results;
    data.sort((a, b) => a.Model_Name.localeCompare(b.Model_Name));
    let imgData = [];
    for (let c of data) {
      let findCurrentCar = await db.car.findOne({
        where: { make: c.Make_Name, model: c.Model_Name }
      });
      if (findCurrentCar) {
        imgData.push(findCurrentCar);
      } else {
        imgData.push({
          dataValues: {
            make: c.Make_Name,
            model: c.Model_Name,
            image: 'https://i.ibb.co/PwkqdSy/placeholder.png',
            favcount: 0
          }
        });
      }
    }
    const total = imgData.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pagedCars = imgData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const baseUrl = `/cars?selectmake=${encodeURIComponent(userQuery.selectmake)}&page=`;
    res.render('cars', { search: userQuery.selectmake, carImg: pagedCars, page, totalPages, total, baseUrl });
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
      const image = car ? car.image : 'https://i.ibb.co/PwkqdSy/placeholder.png';
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

      // Helper: fetch summary for a known title
      async function wikiByTitle(title) {
        try {
          const r = await axios.get(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
            { timeout: 4000 }
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
            timeout: 4000
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

      // Pull manufacturer country from NHTSA
      let country = null;
      try {
        const mfrRes = await axios.get(`${baseURL}getallmanufacturers${endOfURL}`);
        const mfr = mfrRes.data.Results.find(m =>
          m.Mfr_CommonName && m.Mfr_CommonName.toLowerCase() === make.toLowerCase()
        );
        if (mfr) country = mfr.Country;
      } catch (e) { /* non-critical */ }

      // Car specs from RapidAPI
      let carSpecs = null;
      if (process.env.CKEY) {
        try {
          const specsRes = await axios.get(`${CarAPIbaseURI}/cars`, {
            params: { limit: 5, page: 0, make: make, model: model },
            headers: {
              'X-RapidAPI-Key': process.env.CKEY,
              'X-RapidAPI-Host': 'car-data.p.rapidapi.com'
            },
            timeout: 4000
          });
          if (specsRes.data && specsRes.data.length > 0) {
            // Sort by year descending, get most recent
            const sorted = specsRes.data.sort((a, b) => (b.year || 0) - (a.year || 0));
            carSpecs = sorted[0];
            // Add year range
            const years = specsRes.data.map(s => s.year).filter(Boolean);
            carSpecs.yearMin = Math.min(...years);
            carSpecs.yearMax = Math.max(...years);
          }
        } catch (e) { /* non-critical */ }
      }

      res.render('cars/detail', {
        make, model, image, favcount, relatedCars, country, wikiSummary, wikiUrl, mediaLinks, carSpecs,
        ogTitle: make + ' ' + model + ' — AutoDex',
        ogDescription: wikiSummary ? wikiSummary.slice(0, 160) : make + ' ' + model + ' on AutoDex.',
        ogImage: image
      });
    } catch (err) {
      console.log('CAR DETAIL ERROR:', err);
      res.status(500).send('Error loading car details.');
    }
  });

  // GET Route for /favorites
  router.get('/favorites/', isLoggedIn, async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const total = await db.favorite_car.count({ where: { userId: req.user.id } });
    const totalPages = Math.ceil(total / PAGE_SIZE);
    let favorites = await db.favorite_car.findAll({
      where: { userId: req.user.id },
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE
    });
    favorites = favorites.map(r => r.toJSON());
    res.render('favorites', { favorites, page, totalPages, total, baseUrl: '/cars/favorites/?page=' });
  });

  // DELETE ROUTE for /favorites
  router.delete('/favorites/delete/:id', isLoggedIn, async (req, res) => {
    try{
      let deleteFav = await db.favorite_car.destroy({
        where: {
          id: req.params.id
        }
      })
      res.redirect('../../favorites')
    } catch (error1) {
      console.log('DELETE ERROR:', error1)
    }
  })

  // PUT Route for /favorites/:id
  router.put('/favorites/edit/:id', isLoggedIn, async (req, res) => {
    let postData = req.body;
    console.log('POST REQ BODY:', postData)
    db.favorite_car.update({
        image: postData.newimagelink
    },
    {where:{
        id: postData.favid
    }}
    ).then((response) => {
        console.log('POST RES:', response)
        res.redirect('../../favorites')
    })
    .catch(err => {console.log('PUT ERROR:', err)})
  })

  // POST route cars/fav
  router.post('/fav', isLoggedIn, async (req, res) => {
    let data = req.body;
    let [favCar] = await db.car.findOrCreate({
        where: {
            make: data.favecar_make,
            model: data.favecar_model,
        },
        defaults: {
            image: data.favecar_image || 'https://i.ibb.co/PwkqdSy/placeholder.png',
            favcount: 0,
            updated_img: false
        }
    })
    console.log('AWAIT RESULT - FAVCAR:', favCar);
    let newFavCar = await db.favorite_car.findOrCreate({
        where: {
            make: data.favecar_make,
            model: data.favecar_model,
            image: data.favecar_image,
            carId: favCar.id,
            userId: parseInt(data.userId)
        }
    })
    console.log('AWAIT NEW FAV CAR INFO', newFavCar);
    let foundCar = await db.car.findOne({
        where: {
            id: favCar.id
        }
    })
    console.log('FOUND CAR AWAIT', foundCar);
    let currentFavCount = parseInt(foundCar.favcount) || 0;

    if(favCar.id === newFavCar[0].carId && parseInt(data.userId) === newFavCar[0].userId) {
        console.log('ALREADy IN FAVORITES');
        if (req.get('X-Requested-With') === 'XMLHttpRequest') { return res.json({ success: true }); }
        return res.redirect('favorites');
    } else {
        db.car.update({
            favcount: currentFavCount += 1,
            image: data.favecar_image
        },
        {
            where: {
                id: foundCar.id
            }
        })
        .then(response => {
            const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
            if (isAjax) { res.json({ success: true }); } else { res.redirect('favorites'); }
            console.log('ADD CAR TO CARS ATTEMPT')
        })
        .catch((err) => {
            console.log('ERROR', err);
        })
        .finally(() => {
            console.log('SUCCESSFULLY ADDED CAR to CARS TABLE')
        });
    }
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