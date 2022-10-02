const db = require('./models');
require('dotenv').config();
const express = require('express');
const layouts = require('express-ejs-layouts');
const app = express();
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('./config/ppConfig');
const isLoggedIn = require('./middleware/isLoggedIn');
const axios = require('axios');
const { application, request } = require('express');

// For Car Data API calls
const CarAPIbaseURI = 'https://car-data.p.rapidapi.com';
const CarAPIKey = process.env.CKEY;
const uSplashKey = process.env.USPLASHKEY;
const uSplashSKey = process.env.USPLASHSKEY;
const uSplashBaseURL = 'https://api.unsplash.com/';
const baseURL = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
const allManufacturers = 'getallmanufacturers';
const uSplashEnd = `client_id=${uSplashKey}`

// axios.get(`${uSplashBaseURL}search/photos?page=1&per_page=1&query=bmw+m3&${uSplashEnd}`)
// .then(results => {
//     console.log('RESULTS HERE', results.data.results[0].urls.small);
// }).catch(err => {
//     console.log(err);
// });

// async function searchCar() {
//      let makeSearch = 'bmw';  
//      let modelSearch = 'm3';  
//      let getCarImage = await axios.get(`https://api.unsplash.com/search/photos?page=1&per_page=1&query=tesla+model+s&client_id=LrrjnOtgEIVv224LGCaCcIHGJnJX-uVpq_UApkEu6zc`)
//      .catch((err) => {console.log(err)}); 
//          //let imgURL = getCarImage.searchResults.data.results[0].urls.small; 
//          console.log(getCarImage.data.results[0].urls.small);
//     }
    
// searchCar();






// DELETE CRASHED ROWS
// let destroyEntry = db.car.destroy({
//     where: {
//         make: 'CUSTOM CYCLE STUDIO LLC'
//     }
// }).then((result) => {
//     console.log('DESTROYED', result, 'DESTROYED ENTRY:', destroyEntry);
// }).catch((err) => {console.log('ERROR', err)})





// Get images from Unsplash API in increments of 50 per hour
async function unsplashImages() {
    db.car.findAll({
      where: {
        updated_img: false
      }
    })
    .then(async carimg => {
      console.log(carimg[0].dataValues);
      for (let i = 0; i < 50; i++) {
        let index = carimg[i].dataValues;
        let getCarImage = await axios.get(`${uSplashBaseURL}search/photos?orientation=landscape&page=1&per_page=1&query=${index.make.replaceAll(' ', '+')}+${index.model.replaceAll(' ', '+')}&${uSplashEnd}`)
        .catch(err => {console.log('UNSPLASH API PULL ERROR', err)})
        let imgURL = getCarImage.data.results[0].urls.full;
        let addImagesToDatabase = db.car.update({
          updated_img: true,
          image: `${imgURL}`
        },
        {
          where: {
            make: index.make,
            model: index.model
          }
        }).catch(error => {console.log('UNSPLASH API PUSH ERROR:', error)})
      }
      console.log('IMAGES ADDED:', addImagesToDatabase)
    })
    .catch(err => {console.log('ERROR', err)})
    .finally(() => {console.log('ADDING IMAGES COMPLETED')});
  }
  
  //setInterval(unsplashImages, 3700000);
  gitunsplashImages();