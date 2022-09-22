const express = require('express');
const router = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const axios = require('axios');
const { request } = require('express');
const app = express();

// For Car Data API calls
const CarAPIbaseURI = 'https://car-data.p.rapidapi.com';
const CarAPIKey = process.env.CKEY;
const baseURL = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
const allMakes = 'getallmanufacturers/';
const allModelsByMake = 'getmodelsformake/'; // needs model name
const endOfURL = '?format=json';

// GET route for submitted form data from home route
router.get('/', (req, res) => {
    let userQuery = req.query;
    axios.get(`${baseURL}${allModelsByMake}${userQuery.selectmake}${endOfURL}`)
    .then((response) => {
      let data = response.data.Results;
      res.render('cars', { cars: data, search: userQuery.selectmake });
    })
    .catch((err) => {
      console.log(err);
    })
    .finally(() => {
      console.log('MESSAGE: submitted form data from home route');
    });
  });

  // POST route cars/fav
  router.post('/fav', (req, res) => {
    let data = req.body;
    db.car.findOrCreate({
        where: {
            make: data.favecar_make,
            model: data.favecar_model,
        }
    })
    db.favorite_car.create({
        carId: 2
    })
    .then(response => {
        console.log('ADD CAR TO CARS ATTEMPT')
    })
    .catch((err) => {
        console.log('ERROR', err);
    })
    .finally(() => {
        console.log('SUCCESSFULLY ADDED CAR to CARS TABLE')
    });
    // // add to favorite_cars
    // db.favorite_car.create({
    //     carId: 2
    // })
    // .then(response => {
    //     console.log('ADD CAR TO FAVORITES ATTEMPT')
    // })
    // .catch((err) => {
    //     console.log('ERROR', err);
    // })
    // .finally(() => {
    //     console.log('SUCCESSFULLY ADDED CAR TO FAVORITES')
    // });
    // add favcout
    db.car.findOne({
        where: {
            make: data.favecar_make,
            model: data.favecar_model
        }
    }).then(foundCar => {
        console.log('FAVCAR DATA:', foundCar);
    }).catch((err) => {
        console.log('FINDCAR ERROR:', err);
    });
    db.car.update({
        favcount: 1,
      }, 
      {
        where: { 
            make: data.favecar_make,
            model: data.favecar_model
        }
    })
    .then((favCountEdit) => {
    res.redirect('/');
      console.log('FAVCARCOUNT UPDATE ATTEMPT')
    })
    .catch((err) => {
        console.log('FAVCOUNT ERROR:', err);
    })
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