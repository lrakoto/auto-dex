// Daily car puzzle at /puzzle — one mystery car a day, the same for everyone
// (lib/puzzle.js). Guesses and their results live in the session so refreshing
// keeps today's progress; a new UTC day starts a fresh board. Works without
// JS (plain form post + redirect); the datalist at /puzzle/suggest is a
// progressive-enhancement nicety, not a requirement to play.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const puzzle = require('../lib/puzzle');

const guessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Slow down, speed racer. Try again in a few minutes.'
});

const suggestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// A fresh board for today if there's none yet, or yesterday's is still there
function state(req) {
  const day = todayKey();
  if (!req.session.puzzle || req.session.puzzle.day !== day) {
    req.session.puzzle = { day, guesses: [], done: false, won: false, error: null };
  }
  return req.session.puzzle;
}

const carPath = (make, model) => `/cars/car?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;

router.get('/', async (req, res) => {
  try {
    const answer = await puzzle.getPuzzleCar();
    const s = state(req);
    const error = s.error;
    s.error = null;
    res.render('puzzle', {
      answer,
      guesses: s.guesses,
      done: s.done,
      won: s.won,
      error,
      maxGuesses: puzzle.MAX_GUESSES,
      guessesLeft: puzzle.MAX_GUESSES - s.guesses.length,
      answerUrl: s.done && answer ? carPath(answer.make, answer.model) : null,
      pageTitle: "Daily Car Puzzle — AutoDex",
      pageDescription: 'Guess today\'s mystery car in six tries. Every guess checks the make, country and decade against the answer.',
      canonicalPath: '/puzzle'
    });
  } catch (err) {
    console.log('PUZZLE ERROR:', err);
    res.status(500).send('Error loading the puzzle.');
  }
});

router.post('/guess', guessLimiter, async (req, res) => {
  const s = state(req);
  if (s.done || s.guesses.length >= puzzle.MAX_GUESSES) return res.redirect('/puzzle');
  try {
    const answer = await puzzle.getPuzzleCar();
    if (!answer) return res.redirect('/puzzle');

    const text = (req.body.guess || '').trim();
    const guessCar = await puzzle.findGuessCar(text);
    if (!guessCar) {
      s.error = text ? `"${text}" isn't a car AutoDex can score yet.` : 'Type a car to guess.';
      return res.redirect('/puzzle');
    }

    const result = puzzle.compareGuess(guessCar, answer);
    const correct = guessCar.id === answer.id;
    s.guesses.push({ ...result, correct });
    if (correct || s.guesses.length >= puzzle.MAX_GUESSES) {
      s.done = true;
      s.won = correct;
    }
    res.redirect('/puzzle');
  } catch (err) {
    console.log('PUZZLE GUESS ERROR:', err);
    res.redirect('/puzzle');
  }
});

router.get('/suggest', suggestLimiter, async (req, res) => {
  try {
    const names = await puzzle.suggestGuesses(req.query.q);
    res.json({ names });
  } catch (err) {
    console.log('PUZZLE SUGGEST ERROR:', err);
    res.json({ names: [] });
  }
});

module.exports = router;
