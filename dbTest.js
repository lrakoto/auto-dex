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
const { application } = require('express');

// For Car Data API calls
const CarAPIbaseURI = 'https://car-data.p.rapidapi.com';
const CarAPIKey = process.env.CKEY;
const baseURL = 'https://vpic.nhtsa.dot.gov/api/vehicles/';
const allManufacturers = 'getallmanufacturers';

// AXIOS GET TEST

// axios.get('https://vpic.nhtsa.dot.gov/api/vehicles/getallmanufacturers?format=json')
// .then((response) => {
//     let data = response.data.Results;
//     console.log(data[0].Mfr_Name);
//     data.forEach(element => {
//         if(element.Country === 'UNITED STATES (USA)' && element.Mfr_CommonName !== null) {
//             console.log(element.Mfr_CommonName);
//         }
//     });
// })
// .catch((err) => {
//     console.log(err);
// })
// .finally(() => {
//     console.log('it worked');
// });



// Implement CRUD for user model

// CREATE
async function createUser() {
    try {
        const newUser = await db.user.create({
            name: "My Name",
            email: "myemail@gmail.com"
        });
        console.log('my new user >>>', newUser);
    } catch (error) {
        console.log('new user was not created b/c of >>>', error);
    }
    
}
// @todo run createUser function below

// READ
// find one user
async function findOneUser() {
    try {
        const user = await db.user.findOne({
            where: { id: 1 }
        });
        console.log('current user here >>>', user);  
    } catch (error) {
        console.log('did not find user b/c of >>>', error);
    }
}
// @todo run findOneUser function below

// find all users
async function findAllUsers() {
    try {
        const users = await db.user.findAll();
        console.log('all users here >>>', users);  
    } catch (error) {
        console.log('did not find all users because of >>>', error);
    }
}
// @todo run findAllUsers function below

// find one user
async function findOrCreate() {
    try {
        const users = await db.user.findOrCreate({
            where: { email: 'brainsmith@gmail.com' },
            defaults: {
                name: 'Brian Smith',
            },
        });
        console.log('all users here >>>', users);  
    } catch (error) {
        console.log('did not find all users because of >>>', error);
    }
}
// @todo run findOrCreate function below

// UPDATE
async function updateUser() {
    try {
        const numRowsUpdated = await db.user.update({
            name: 'Brain Taco'
        }, {
            where: {
                email: 'brainsmith@gmail.com'
            }
        });
        console.log('number of users updated', numRowsUpdated);
    } catch (error) {
        console.log('did not update user(s) because of >>>', error);
    }
}
// @todo run updateUser function below

// DELETE
async function deleteUser() {
    try {
        let numOfRowsDeleted = await db.user.destroy({
            where: { email: 'brainsmith@gmail.com' }
        });
        console.log('number of rows deleted >>>', numOfRowsDeleted);
    } catch (error) {
        console.log('did not delete user(s) because of >>>', error);
    }
}
// @todo run deleteUser function below