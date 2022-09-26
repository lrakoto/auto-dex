const express = require('express');
const router = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const axios = require('axios');
const app = express();

require('dotenv').config();
const layouts = require('express-ejs-layouts');
const session = require('express-session');
const flash = require('connect-flash');
const { application, request } = require('express');

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



// GET route for submitted form data from home route
router.get('/', (req, res) => {
    let userQuery = req.query;
    axios.get(`${baseURL}${allModelsByMake}${userQuery.selectmake}${endOfURL}`)
    .then(async (response) => {
    let newData = [];
    let data = response.data.Results;
    let getImgData = await data.forEach(async (e) => {
        let makeSearch = e.Make_Name.toLowerCase();
        let modelSearch = e.Model_Name.toLowerCase();
        let imgURL = '';
        let dataToPush = {};
        let getCarImage = await axios.get(`${uSplashBaseURL}search/photos?orientation=landscape&page=1&per_page=1&query=${makeSearch}+${modelSearch.replaceAll(' ', '+')}&${uSplashEnd}`)
        .catch((apiLimitReached) => {
            console.log('UNSPLASH API LIMIT REACHED', apiLimitReached);
            imgURL = '../public/assets/placeholder.png';
            dataToPush.make = makeSearch;
            dataToPush.model = modelSearch;
            dataToPush.image = imgURL;
            newData.push(dataToPush);
            db.car.findOrCreate({
                where: {
                    make: makeSearch,
                    model: modelSearch,
                    image: imgURL
                }
            })
            res.redirect('../');
        })
        console.log('IMGDATA', getCarImage.data.results[0].urls.small);
        console.log('NEWCARS', newData);
        imgURL = getCarImage.data.results[0].urls.small;
        dataToPush.make = makeSearch;
        dataToPush.model = modelSearch;
        dataToPush.image = imgURL;
        newData.push(dataToPush);
        db.car.findOrCreate({
            where: {
                make: makeSearch,
                model: modelSearch,
                image: imgURL
            }
        })
        // Replaces image with live image if placeholder image are in tables
        db.car.update({
            image: imgURL
        }, 
        {
            where: { 
                make: makeSearch,
                model: modelSearch
            }
        })
    }).catch((err) => {console.log('ERROR', err)})
    function renderPage() {
        res.render('cars', { newcars: newData, search: userQuery.selectmake});
        console.log('AFTER', newData);
    };
    setInterval(renderPage, 1000);
    })
    .catch((err) => {
      console.log('RENDER ERROR:', err);
    })
    .finally(() => {
      console.log('MESSAGE: submitted form data from home route');
    });
  });

  // /favorites
  router.get('/favorites', async (req, res) => {
    let favorites = await db.favorite_car.findAll();
    favorites = favorites.map((r => r.toJSON()));
    console.log('FAVORITE CARS', favorites);
    res.render('favorites', { favorites: favorites});
  });

  // POST route cars/fav
  router.post('/fav', async (req, res) => {
    let data = req.body;
    let newCar = await db.car.findOrCreate({
        where: {
            make: data.favecar_make,
            model: data.favecar_model,
        }
    })
    console.log('AWAIT RESULT', newCar);
    let newFavCar = await db.favorite_car.findOrCreate({
        where: {
            make: newCar[0].make,
            model: newCar[0].model,
            image: data.favecar_image,
            carId: newCar[0].id,
            userId: data.userId
        }
    })
    console.log('AWAIT NEW FAV CAR INFO', newFavCar);
    let foundCar = await db.car.findOne({
        where: { 
            id: newCar[0].id
        }
    })
    console.log('FOUND CAR AWAIT', foundCar);
    let currentFavCount = foundCar.favcount;
    
    if(newCar[0].id === newFavCar[0].carId && parseInt(data.userId) === newFavCar[0].userId) {
        console.log('ALREADy IN FAVORITES');
        res.redirect('/');
    } else {
        db.car.update({
            favcount: currentFavCount + 1
        }, 
        {
            where: { 
                id: foundCar.id
            }
        })
        .then(response => {
            res.redirect('/');
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