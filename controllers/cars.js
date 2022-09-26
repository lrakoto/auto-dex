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
    .then((response) => {
    let newData = [];
    let data = response.data.Results;
    data.forEach(async (e) => {
        let makeSearch = e.Make_Name.toLowerCase();
        let modelSearch = e.Model_Name.toLowerCase();
        let getCarImage = await axios.get(`${uSplashBaseURL}search/photos?page=1&per_page=1&query=${makeSearch}+${modelSearch.replaceAll(' ', '+')}&${uSplashEnd}`)
        .catch(error => {
            console.log(error);
        })
        let imgURL = getCarImage.data.results[0].urls.small;
        let dataToPush = {};
        dataToPush.make = makeSearch;
        dataToPush.model = modelSearch;
        dataToPush.image = imgURL;
        newData.push(dataToPush);
        console.log('DATATEST:', newData)
        res.render('cars', { cars: data, search: userQuery.selectmake, newData: newData});
    })
    })
    .catch((err) => {
      console.log(err);
    })
    .finally(() => {
      console.log('MESSAGE: submitted form data from home route');
    });
  });

  // results
  router.get('/results', async (req, res) => {
    let results = await db.favorite_car.findAll();
    results = results.map((r => r.toJSON()));
    console.log(results);
    res.render('cars/results', { results: results});
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