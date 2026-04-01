const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const passport = require('../config/ppConfig');
const db = require('../models');
const { sendVerificationEmail } = require('../config/email');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/signup', (req, res) => {
  res.render('auth/signup');
});

router.get('/login', (req, res) => {
  if (req.query.returnTo) req.session.returnTo = req.query.returnTo;
  res.render('auth/login');
});

router.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', 'Either email or password is incorrect');
      return res.redirect('/auth/login');
    }
    if (!user.emailVerified) {
      req.flash('error', 'Please verify your email before logging in. Check your inbox.');
      return res.redirect('/auth/login');
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      db.user.update({ lastLoginAt: new Date() }, { where: { id: user.id } }).catch(() => {});
      req.flash('success', 'Welcome back...');
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  })(req, res, next);
});

router.get('/logout', (req, res) => {
  req.logOut(() => {});
  req.flash('success', 'Logging out... See you next time!');
  res.redirect('/');
});

router.post('/signup', async (req, res) => {
  const { email, name, password } = req.body;
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const [user, created] = await db.user.findOrCreate({
      where: { email },
      defaults: { name, password, emailVerified: false, verificationToken: token }
    });

    if (created) {
      console.log(`----- ${user.name} was created -----`);
      try {
        await sendVerificationEmail(email, name, token);
      } catch (emailErr) {
        console.log('EMAIL SEND ERROR:', emailErr);
      }
      req.flash('success', `Welcome ${user.name}! Check your email to verify your account before logging in.`);
      res.redirect('/auth/login');
    } else {
      req.flash('error', 'Email already exists');
      res.redirect('/auth/signup');
    }
  } catch (error) {
    console.log('SIGNUP ERROR:', error);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/signup');
  }
});

// GET /auth/verify/:token
router.get('/verify/:token', async (req, res) => {
  try {
    const user = await db.user.findOne({ where: { verificationToken: req.params.token } });
    if (!user) {
      req.flash('error', 'Verification link is invalid or has already been used.');
      return res.redirect('/auth/login');
    }
    await user.update({ emailVerified: true, verificationToken: null });
    req.flash('success', 'Email verified! You can now log in.');
    res.redirect('/auth/login');
  } catch (err) {
    console.log('VERIFY ERROR:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/login');
  }
});

// POST /auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await db.user.findOne({ where: { email } });
    if (!user || user.emailVerified) {
      req.flash('error', 'No unverified account found for that email.');
      return res.redirect('/auth/login');
    }
    const token = crypto.randomBytes(32).toString('hex');
    await user.update({ verificationToken: token });
    await sendVerificationEmail(email, user.name, token);
    req.flash('success', 'Verification email resent. Check your inbox.');
    res.redirect('/auth/login');
  } catch (err) {
    console.log('RESEND ERROR:', err);
    req.flash('error', 'Could not resend. Please try again.');
    res.redirect('/auth/login');
  }
});

module.exports = router;
