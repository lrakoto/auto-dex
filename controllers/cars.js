const express = require('express');
const router = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const axios = require('axios');
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
      console.log('success');
    });
  });

  // GET route cars/fav
  router.get('/fav', (req, res) => {
    let data = req.body;
    console.log(req.body)
        console.log('RES BODY:', res.body);
        console.log('REQ BODY:', req.body);
        res.render('cars/fav', { faves: res.body})
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