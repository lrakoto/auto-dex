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

axios.get(`${uSplashBaseURL}search/photos?page=1&per_page=1&query=bmw+m3&${uSplashEnd}`)
.then(results => {
    console.log('RESULTS HERE', results.data.results[0].urls.small);
}).catch(err => {
    console.log(err);
});