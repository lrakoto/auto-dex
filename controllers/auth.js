const express = require('express');
const router  = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const { sendVerificationEmail } = require('../config/email');
const { generateVerificationToken, hashToken, normalizeEmail } = require('../lib/tokens');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

// Guards endpoints that send email via Resend — without this, anyone can
// spam arbitrary inboxes (and burn your Resend quota) on repeat.
const emailSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many requests. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many accounts created from this IP. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Only allow same-origin paths — blocks open redirects like ?returnTo=https://evil.example
function safeReturnTo(url) {
  if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}

router.get('/signup', (req, res) => {
  res.render('auth/signup', {
    pageTitle: 'Sign Up — AutoDex',
    canonicalPath: '/auth/signup',
    noindex: true
  });
});

router.get('/login', (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo);
  if (returnTo) req.session.returnTo = returnTo;
  res.render('auth/login', {
    pageTitle: 'Log In — AutoDex',
    canonicalPath: '/auth/login',
    noindex: true
  });
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
    // keepSessionInfo: passport 0.7 regenerates the session on login — this
    // keeps req.session.returnTo set by GET /auth/login
    req.logIn(user, { keepSessionInfo: true }, (err) => {
      if (err) return next(err);
      db.user.update({ lastLoginAt: new Date() }, { where: { id: user.id } }).catch(() => {});
      req.flash('success', 'Welcome back...');
      // Re-validate at use time in case the session value ever came from elsewhere
      const returnTo = safeReturnTo(req.session.returnTo) || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  })(req, res, next);
});

// POST only — a GET logout is trivially CSRF-able (e.g. <img src="/auth/logout">)
router.post('/logout', (req, res, next) => {
  req.logOut((err) => {
    if (err) return next(err);
    req.flash('success', 'Logging out... See you next time!');
    res.redirect('/');
  });
});

router.post('/signup', signupLimiter, async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  try {
    const token = generateVerificationToken();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const [user, created] = await db.user.findOrCreate({
      where: { email },
      // Only the token's hash is stored — a DB leak can't be replayed to verify
      defaults: {
        name,
        password,
        emailVerified: false,
        verificationToken: hashToken(token),
        verificationTokenExpiresAt: tokenExpiry
      }
    });

    if (created) {
      console.log(`----- ${user.name} was created -----`);
      try {
        await sendVerificationEmail(email, name, token);
      } catch (emailErr) {
        console.log('EMAIL SEND ERROR:', emailErr);
      }
    }
    // Same response whether or not the address was already registered —
    // the old "Email already exists" flash leaked which emails have accounts.
    req.flash('success', `Check your email — if ${email} is new, we've sent a verification link.`);
    res.redirect('/auth/login');
  } catch (error) {
    console.log('SIGNUP ERROR:', error);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/signup');
  }
});

// GET /auth/verify/:token
router.get('/verify/:token', async (req, res) => {
  try {
    // Look up by hash — the plaintext token only ever existed in the email link
    const user = await db.user.findOne({ where: { verificationToken: hashToken(req.params.token) } });
    if (!user) {
      req.flash('error', 'Verification link is invalid or has already been used.');
      return res.redirect('/auth/login');
    }
    if (!user.verificationTokenExpiresAt || new Date(user.verificationTokenExpiresAt) < new Date()) {
      req.flash('error', 'That verification link has expired — request a new one below.');
      return res.redirect('/auth/login');
    }
    await user.update({ emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null });
    req.flash('success', 'Email verified! You can now log in.');
    res.redirect('/auth/login');
  } catch (err) {
    console.log('VERIFY ERROR:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/login');
  }
});

// POST /auth/resend-verification
router.post('/resend-verification', emailSendLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  try {
    const user = await db.user.findOne({ where: { email } });
    if (user && !user.emailVerified) {
      const token = generateVerificationToken();
      await user.update({
        verificationToken: hashToken(token),
        verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      await sendVerificationEmail(email, user.name, token);
    }
    // Same response regardless of whether the account exists / is unverified,
    // so this endpoint can't be used to enumerate addresses.
    req.flash('success', 'If that address needs verification, a new link is on its way.');
    res.redirect('/auth/login');
  } catch (err) {
    console.log('RESEND ERROR:', err);
    req.flash('error', 'Could not resend. Please try again.');
    res.redirect('/auth/login');
  }
});

module.exports = router;
