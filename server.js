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

const SECRET_SESSION = process.env.SECRET_SESSION;
console.log('INJECTION --->>', SECRET_SESSION);

app.set('view engine', 'ejs');

app.use(require('morgan')('dev'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/public'));
app.use(layouts);

app.use(session({
  secret: SECRET_SESSION,
  resave: false,
  saveUninitialized: false
}));

app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  console.log('INJECT res locals --->>', res.locals);
  res.locals.alerts = req.flash();
  res.locals.currentUser = req.user;
  next();
});

// GET Route for Home and search form
app.get('/', (req, res) => {
  axios.get('https://vpic.nhtsa.dot.gov/api/vehicles/getallmanufacturers?format=json')
  .then((response) => {
    let data = response.data.Results;
    res.render('index', {data: data})
  })
  .catch((err) => {
      console.log(err);
  })
  .finally(() => {
      console.log('HOME ROUTE FOR SELECT FIELDS WORKED');
  });
});

// access to all of our auth routes GET /auth/login, GET /auth/signup POST routes
app.use('/auth', require('./controllers/auth'));
app.use('/cars', isLoggedIn, require('./controllers/cars'));

// Add this above /auth controllers
app.get('/profile', isLoggedIn, (req, res) => {
  const { id, name, email } = req.user.get(); 
  res.render('profile', { id, name, email });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🎧 You're listening to the smooth sounds of port ${PORT} 🎧`);
});

module.exports = server;
