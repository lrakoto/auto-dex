const express = require('express');
const router  = express.Router();
const passport = require('../config/ppConfig');
const db = require('../models');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../config/email');
const { generateVerificationToken, hashToken, normalizeEmail } = require('../lib/tokens');
const rateLimit = require('express-rate-limit');

// The whole test suite shares one IP, so it outgrows these per-IP budgets as
// tests are added. Loosen them for NODE_ENV=test only; production values stand.
const limit = n => (process.env.NODE_ENV === 'test' ? n * 100 : n);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: limit(10),            // 10 attempts per window
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

// Guards endpoints that send email via Resend — without this, anyone can
// spam arbitrary inboxes (and burn your Resend quota) on repeat.
const emailSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: limit(3),
  message: 'Too many requests. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: limit(10),
  message: 'Too many accounts created from this IP. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Separate budget from resend-verification so one flow can't lock out the other
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: limit(3),
  message: 'Too many reset requests. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

const resetSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: limit(10),
  message: 'Too many attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

const RESET_TTL_MS = 60 * 60 * 1000; // reset links live for 1 hour

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
      // Stamp the session so a later password reset can sign it out
      req.session.sessionVersion = user.sessionVersion || 0;
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

// ─── PASSWORD RESET ───────────────────────────────────────────────────────────
// 1. POST /auth/forgot emails a single-use link (only its hash is stored).
// 2. GET /auth/reset/:token checks it, moves it into the session and redirects
//    to /auth/reset, so the token doesn't linger in the address bar/history.
// 3. POST /auth/reset sets the password, burns the token, verifies the email
//    (they just proved they control it) and signs out every other session.

async function findUserByResetHash(tokenHash) {
  if (!tokenHash) return null;
  const user = await db.user.findOne({ where: { passwordResetToken: tokenHash } });
  if (!user || !user.passwordResetExpiresAt || new Date(user.passwordResetExpiresAt) < new Date()) return null;
  return user;
}

router.get('/forgot', (req, res) => {
  res.render('auth/forgot', {
    pageTitle: 'Reset Password — AutoDex',
    canonicalPath: '/auth/forgot',
    noindex: true
  });
});

router.post('/forgot', resetRequestLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  try {
    const user = email ? await db.user.findOne({ where: { email } }) : null;
    if (user) {
      const token = generateVerificationToken();
      await user.update({
        passwordResetToken: hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MS)
      });
      // Not awaited: the response time shouldn't reveal whether we sent anything
      sendPasswordResetEmail(email, user.name, token)
        .catch(err => console.log('RESET EMAIL ERROR:', err));
    }
  } catch (err) {
    console.log('FORGOT ERROR:', err);
  }
  // Identical response either way — no account enumeration
  req.flash('success', 'If there\'s an account for that email, a reset link is on its way. It expires in 1 hour.');
  res.redirect('/auth/login');
});

router.get('/reset/:token', async (req, res) => {
  try {
    const tokenHash = hashToken(req.params.token);
    if (!await findUserByResetHash(tokenHash)) {
      req.flash('error', 'That reset link is invalid or has expired. Request a new one below.');
      return res.redirect('/auth/forgot');
    }
    req.session.resetTokenHash = tokenHash;
    res.redirect('/auth/reset');
  } catch (err) {
    console.log('RESET LINK ERROR:', err);
    res.redirect('/auth/forgot');
  }
});

router.get('/reset', async (req, res) => {
  const user = await findUserByResetHash(req.session.resetTokenHash).catch(() => null);
  if (!user) {
    delete req.session.resetTokenHash;
    req.flash('error', 'That reset link is invalid or has expired. Request a new one below.');
    return res.redirect('/auth/forgot');
  }
  res.render('auth/reset', {
    pageTitle: 'Choose a New Password — AutoDex',
    canonicalPath: '/auth/reset',
    noindex: true
  });
});

router.post('/reset', resetSubmitLimiter, async (req, res) => {
  const { password, confirm } = req.body;
  try {
    const user = await findUserByResetHash(req.session.resetTokenHash);
    if (!user) {
      delete req.session.resetTokenHash;
      req.flash('error', 'That reset link is invalid or has expired. Request a new one below.');
      return res.redirect('/auth/forgot');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 99) {
      req.flash('error', 'Passwords must be 8–99 characters.');
      return res.redirect('/auth/reset');
    }
    if (password !== confirm) {
      req.flash('error', 'Those passwords don\'t match.');
      return res.redirect('/auth/reset');
    }
    // Hashed by the beforeUpdate hook in models/user.js
    await user.update({
      password,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      emailVerified: true,
      verificationToken: null,
      verificationTokenExpiresAt: null,
      sessionVersion: (user.sessionVersion || 0) + 1
    });
    delete req.session.resetTokenHash;
    // If this browser was signed in, that session predates the reset too
    req.logOut(() => {
      req.flash('success', 'Password updated. Log in with your new password.');
      res.redirect('/auth/login');
    });
  } catch (err) {
    console.log('RESET ERROR:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/reset');
  }
});

module.exports = router;
