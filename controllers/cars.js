const express = require('express');
const router = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const axios = require('axios');
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



// GET route for submitted form data from home route
router.get('/', (req, res) => {
  console.log(uSplashKey);
    let userQuery = req.query;
    axios.get(`${baseURL}${allModelsByMake}${userQuery.selectmake}${endOfURL}`)
    .then(async (response) => {
      let data = response.data.Results;
      let imgData = [];
      data.forEach(async (c) => {
        let findCurrentCar = await db.car.findOne({
            where: {
                make: c.Make_Name,
                model: c.Model_Name
            }
        })
        imgData.push(findCurrentCar);
      })
      function render() {
        res.render('cars', { search: userQuery.selectmake, carImg: imgData });
      }
      setTimeout(render, 2000);
    })
    .catch((err) => {
      console.log(err);
    })
    .finally(() => {
      console.log('MESSAGE: submitted form data from home route');
    });
});

  // GET Route for /favorites
  router.get('/favorites/', async (req, res) => {
    let favorites = await db.favorite_car.findAll({
      where: {
        userId: req.user.id
      }
    }
    );
    favorites = favorites.map((r => r.toJSON()));
    res.render('favorites', { favorites: favorites});
  });

  // DELETE ROUTE for /fvorites
  router.delete('/favorites/delete/:id', async (req, res) => {
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
  router.post('/favorites/edit/:id', async (req, res) => {
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
  router.post('/fav', async (req, res) => {
    let data = req.body;
    let favCar = await db.car.findAll({
        where: {
            make: data.favecar_make,
            model: data.favecar_model,
        }
    })
    console.log('AWAIT RESULT - FAVCAR:', favCar);
    let newFavCar = await db.favorite_car.findOrCreate({
        where: {
            make: data.favecar_make,
            model: data.favecar_model,
            image: data.favecar_image,
            carId: favCar[0].id,
            userId: parseInt(data.userId)
        }
    })
    console.log('AWAIT NEW FAV CAR INFO', newFavCar);
    let foundCar = await db.car.findOne({
        where: { 
            id: favCar[0].id
        }
    })
    console.log('FOUND CAR AWAIT', foundCar);
    let currentFavCount = parseInt(foundCar.favcount);
    
    if(favCar[0].id === newFavCar[0].carId && parseInt(data.userId) === newFavCar[0].userId) {
        console.log('ALREADy IN FAVORITES');
        res.redirect('favorites');
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
            res.redirect('favorites');
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