const express = require('express');
const router = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const axios = require('axios');
const app = express();

const baseURL = 'https://vpic.nhtsa.dot.gov/api/vehicles/';

router.get('/cars', (req, res) => {
    const sTerm = req.query.search;
    axios.get('https://vpic.nhtsa.dot.gov/api/vehicles/getallmakes')
    .then((response) => {
        res.render('/cars', {response: response});
        //res.send(response.data);
    }).catch((err) => {
        console.log(err);
    }).finally(() => {
        console.log('it worked');
    });
})