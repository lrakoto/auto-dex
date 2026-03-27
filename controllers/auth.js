const express = require('express');
const router = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');

router.get("/signup", (req, res) => {
  res.render("auth/signup");
});

router.get("/login", (req, res) => {
  if (req.query.returnTo) req.session.returnTo = req.query.returnTo;
  res.render("auth/login");
});

router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', 'Either email or password is incorrect');
      return res.redirect('/auth/login');
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      req.flash('success', 'Welcome back...');
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  })(req, res, next);
});

router.get('/logout', (req, res) => {
  req.logOut(() => {
    console.log('I am logged out');
  }
  ); // logs the user out of the session
  req.flash('success', 'Logging out... See you next time!');
  res.redirect('/');
});

router.post('/signup', async (req, res) => {
  // we now have access to the user info (req.body);
  const { email, name, password } = req.body; // goes and us access to whatever key/value inside of the object
  try {
    const [user, created] = await db.user.findOrCreate({
        where: { email },
        defaults: { name, password }
    });

    if (created) {
        // if created, success and we will redirect back to / page
        console.log(`----- ${user.name} was created -----`);
        const successObject = {
            successRedirect: '/',
            successFlash: `Welcome ${user.name}. Account was created and logging in...`
        }
        // 
        passport.authenticate('local', successObject)(req, res);
    } else {
      // Send back email already exists
      req.flash('error', 'Email already exists');
      res.redirect('/auth/signup'); // redirect the user back to sign up page to try again
    }
  } catch (error) {
        // There was an error that came back; therefore, we just have the user try again
        console.log('**************Error');
        console.log(error);
        req.flash('error', 'Either email or password is incorrect. Please try again.');
        res.redirect('/auth/signup');
  }
});

module.exports = router;