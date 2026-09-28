// "Who's That Car?" at /play — see lib/quiz.js. The round and streak live in
// the session, so refreshing re-shows the same car (no skipping one you don't
// know) and the answer never leaves the server until it's guessed. Works
// without JS (form posts + redirect); public/js/play.js makes it instant.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../models');
const { getMakeCountry } = require('../config/carquery');
const { formatYears } = require('../lib/carinfo');
const quiz = require('../lib/quiz');

const guessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Slow down, speed racer. Try again in a few minutes.'
});

const carPath = (make, model) => `/cars/car?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;

function state(req) {
  if (!req.session.quiz) req.session.quiz = { round: null, streak: 0, best: 0, recent: [] };
  return req.session.quiz;
}

// The pending round's view, starting a fresh round if there's none (or its
// cars left the catalog)
async function currentRound(s) {
  let view = await quiz.roundView(s.round);
  if (!view) {
    s.round = await quiz.newRound(s);
    view = await quiz.roundView(s.round);
  }
  return view;
}

// Signed-in players' records outlive the session
function bestFor(req, s) {
  return Math.max(s.best, (req.user && req.user.quizBest) || 0);
}

router.get('/', async (req, res) => {
  try {
    const s = state(req);
    const [round, leaders] = await Promise.all([currentRound(s), quiz.getLeaders()]);
    const last = s.last || null; // result of a no-JS guess, shown once
    delete s.last;
    res.render('play', {
      round, last,
      streak: s.streak,
      best: bestFor(req, s),
      leaders: leaders.map(u => u.toJSON()),
      pageTitle: "Who's That Car? — Photo Quiz — AutoDex",
      pageDescription: 'Name the car in the photo. Four choices, a streak to protect, and the choices get closer every three in a row.',
      canonicalPath: '/play'
    });
  } catch (err) {
    console.log('PLAY ERROR:', err);
    res.status(500).send('Error loading the quiz.');
  }
});

// POST /play/guess — { choice: carId }. JSON for fetch(), redirect otherwise.
router.post('/guess', guessLimiter, async (req, res) => {
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  const s = state(req);
  const round = s.round;
  const choice = parseInt(req.body.choice, 10);
  // No round, or a stale tab answering a round that's already over
  if (!round || !round.choices.includes(choice)) {
    return isAjax ? res.status(409).json({ success: false, stale: true }) : res.redirect('/play');
  }
  try {
    const correct = choice === round.answer;
    s.streak = correct ? s.streak + 1 : 0;
    s.best = Math.max(s.best, s.streak);
    s.round = null;
    if (correct && req.user && s.streak > (req.user.quizBest || 0)) {
      await quiz.saveBest(req.user.id, s.streak);
    }

    const car = await db.car.findByPk(round.answer);
    const reveal = {
      correct,
      choice,
      answerId: round.answer,
      make: car ? car.make : null,
      model: car ? car.model : null,
      years: formatYears(car),
      country: car ? getMakeCountry(car.make) : null,
      url: car ? carPath(car.make, car.model) : null
    };
    const next = await currentRound(s);

    if (isAjax) return res.json({ success: true, ...reveal, streak: s.streak, best: bestFor(req, s), next });
    s.last = reveal;
    res.redirect('/play');
  } catch (err) {
    console.log('GUESS ERROR:', err);
    if (isAjax) return res.status(500).json({ success: false });
    res.redirect('/play');
  }
});

// POST /play/skip — a new car; skipping ends the streak
router.post('/skip', guessLimiter, async (req, res) => {
  const s = state(req);
  s.round = null;
  s.streak = 0;
  res.redirect('/play');
});

module.exports = router;
