// "Who's That Car?" at /play — see lib/quiz.js. The round and streak live in
// the session, so refreshing re-shows the same car (no skipping one you don't
// know) and the answer never leaves the server until it's guessed. Works
// without JS (form posts + redirect); public/js/play.js makes it instant.
// ?type=motorcycle plays the motorcycle round: its own streak in the session,
// while saved bests, the badge and the leaderboard stay with cars.
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

const quizType = v => (quiz.QUIZ_TYPES.includes(v) ? v : 'car');
const playPath = type => (type === 'car' ? '/play' : `/play?type=${type}`);

// Cars keep the original session key, so rounds in progress survive deploys
function state(req, type = 'car') {
  const key = type === 'car' ? 'quiz' : `quiz_${type}`;
  if (!req.session[key]) req.session[key] = { round: null, streak: 0, best: 0, recent: [] };
  return req.session[key];
}

// The pending round's view, starting a fresh round if there's none (or its
// cars left the catalog)
async function currentRound(s, type) {
  let view = await quiz.roundView(s.round);
  if (!view) {
    s.round = await quiz.newRound(s, type);
    view = await quiz.roundView(s.round);
  }
  return view;
}

// Signed-in players' records outlive the session (cars only, for now)
function bestFor(req, s, type) {
  return type === 'car' ? Math.max(s.best, (req.user && req.user.quizBest) || 0) : s.best;
}

router.get('/', async (req, res) => {
  try {
    const type = quizType(req.query.type);
    const s = state(req, type);
    const [round, leaders] = await Promise.all([currentRound(s, type), quiz.getLeaders()]);
    const last = s.last || null; // result of a no-JS guess, shown once
    delete s.last;
    const noun = type === 'car' ? 'Car' : 'Motorcycle';
    res.render('play', {
      round, last, type, noun,
      streak: s.streak,
      best: bestFor(req, s, type),
      leaders: leaders.map(u => u.toJSON()),
      pageTitle: `Who's That ${noun}? — Photo Quiz — AutoDex`,
      pageDescription: `Name the ${noun.toLowerCase()} in the photo. Four choices, a streak to protect, and the choices get closer every three in a row.`,
      canonicalPath: playPath(type)
    });
  } catch (err) {
    console.log('PLAY ERROR:', err);
    res.status(500).send('Error loading the quiz.');
  }
});

// POST /play/guess — { choice: carId }. JSON for fetch(), redirect otherwise.
router.post('/guess', guessLimiter, async (req, res) => {
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  const type = quizType(req.body.type);
  const s = state(req, type);
  const round = s.round;
  const choice = parseInt(req.body.choice, 10);
  // No round, or a stale tab answering a round that's already over
  if (!round || !round.choices.includes(choice)) {
    return isAjax ? res.status(409).json({ success: false, stale: true }) : res.redirect(playPath(type));
  }
  try {
    const correct = choice === round.answer;
    s.streak = correct ? s.streak + 1 : 0;
    s.best = Math.max(s.best, s.streak);
    s.round = null;
    if (type === 'car' && correct && req.user && s.streak > (req.user.quizBest || 0)) {
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
    const next = await currentRound(s, type);

    if (isAjax) return res.json({ success: true, ...reveal, streak: s.streak, best: bestFor(req, s, type), next });
    s.last = reveal;
    res.redirect(playPath(type));
  } catch (err) {
    console.log('GUESS ERROR:', err);
    if (isAjax) return res.status(500).json({ success: false });
    res.redirect(playPath(type));
  }
});

// POST /play/skip — a new car; skipping ends the streak
router.post('/skip', guessLimiter, async (req, res) => {
  const type = quizType(req.body.type);
  const s = state(req, type);
  s.round = null;
  s.streak = 0;
  res.redirect(playPath(type));
});

module.exports = router;
