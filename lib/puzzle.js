// Daily car puzzle: one mystery catalog car a day, the same for every player,
// guessed by name. Each guess compares make, country and decade against the
// answer (exact / close / wrong, with an up/down arrow on the decade) — the
// photo never shows, so there's no need to touch lib/photos.js.
// Reuses the "Car of the Day" hashing trick (lib/daily.js) with its own salt,
// so the two features don't always land on the same car. No table, no job.
const db = require('../models');
const { MAKES_LIST, getMakeCountry } = require('../config/carquery');
const { vehicleTypeWhere, filterListed } = require('./catalog');

const { Op } = db.Sequelize;

const MAX_GUESSES = 6;
const EMPTY_RETRY_MS = 10 * 60 * 1000; // an empty catalog is re-checked soon

// Passenger cars NHTSA (or the years job) has dated, so the puzzle always has
// a decade to compare. Rows the years job hasn't reached yet (lib/jobs/years.js)
// sit out until it gets to them.
function eligibleWhere() {
  return {
    make: { [Op.in]: MAKES_LIST },
    ...vehicleTypeWhere('car'),
    year_min: { [Op.ne]: null }
  };
}

function decadeOf(year) {
  return Math.floor(year / 10) * 10;
}

let cached = { day: null, car: null, at: 0 };

async function getPuzzleCar(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (cached.day === day && (cached.car || Date.now() - cached.at < EMPTY_RETRY_MS)) return cached.car;

  const { fn, literal } = db.Sequelize;
  const candidates = await db.car.findAll({
    attributes: ['id', 'make', 'model', 'year_min'],
    where: eligibleWhere(),
    order: [[fn('md5', literal(`"car"."id"::text || ${db.sequelize.escape('puzzle:' + day)}`)), 'ASC']],
    limit: 8
  });
  const [pick] = await filterListed(candidates);

  const result = pick ? {
    id: pick.id,
    make: pick.make,
    model: pick.model,
    country: getMakeCountry(pick.make),
    decade: decadeOf(pick.year_min)
  } : null;
  cached = { day, car: result, at: Date.now() };
  return result;
}

function clearPuzzleCache() {
  cached = { day: null, car: null, at: 0 };
}

// Resolve a typed guess ("Honda Civic") to a car eligible to be the answer —
// guesses are scored on the same facts as the puzzle, so case and spacing
// shouldn't matter. Make names with their own spaces (Land Rover, Aston
// Martin) rule out splitting the text, so this matches in JS over the whole
// eligible list rather than trying to build one SQL match.
async function findGuessCar(text) {
  const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  const wanted = norm(text);
  if (!wanted) return null;
  const rows = await db.car.findAll({
    attributes: ['id', 'make', 'model', 'year_min'],
    where: eligibleWhere()
  });
  return rows.find(r => norm(`${r.make} ${r.model}`) === wanted) || null;
}

// Up to `limit` "Make Model" matches for the guess field's datalist.
async function suggestGuesses(text, limit = 8) {
  const q = String(text || '').trim();
  if (q.length < 2) return [];
  const { fn, col, literal } = db.Sequelize;
  const rows = await db.car.findAll({
    attributes: ['make', 'model'],
    where: {
      ...eligibleWhere(),
      [Op.and]: [db.Sequelize.where(fn('concat', col('make'), literal("' '"), col('model')), { [Op.iLike]: `%${q}%` })]
    },
    order: [['favcount', 'DESC']],
    limit
  });
  return rows.map(r => `${r.make} ${r.model}`);
}

// Score one guess against the answer. `guess` and `answer` both carry
// make/country/decade (getPuzzleCar's shape; a resolved guess car is turned
// into the same shape by the caller).
function compareGuess(guess, answer) {
  const guessDecade = decadeOf(guess.year_min);
  const diff = Math.abs(guessDecade - answer.decade);
  return {
    make: guess.make,
    model: guess.model,
    makeState: guess.make === answer.make ? 'exact' : 'wrong',
    countryState: getMakeCountry(guess.make) === answer.country ? 'exact' : 'wrong',
    country: getMakeCountry(guess.make),
    decade: guessDecade,
    decadeState: diff === 0 ? 'exact' : (diff <= 10 ? 'close' : 'wrong'),
    decadeDirection: guessDecade === answer.decade ? null : (guessDecade < answer.decade ? 'higher' : 'lower')
  };
}

module.exports = {
  MAX_GUESSES, getPuzzleCar, clearPuzzleCache, findGuessCar, suggestGuesses, compareGuess, decadeOf
};
