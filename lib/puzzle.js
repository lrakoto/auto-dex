// Daily car puzzle: one mystery catalog car a day, the same for every player,
// guessed by name. Each guess compares make, country and decade against the
// answer (exact / close / wrong, with an up/down arrow on the decade) — the
// photo never shows, so there's no need to touch lib/photos.js.
// Reuses the "Car of the Day" hashing trick (lib/daily.js) with its own salt,
// so the two features don't always land on the same car. No table, no job.
const db = require('../models');
const { MAKES_LIST, getMakeCountry } = require('../config/carquery');
const { vehicleTypeWhere, filterListed } = require('./catalog');
const carinfo = require('./carinfo');

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

// Body class, drivetrain and fuel tiles: the same FuelEconomy.gov specs the
// detail page shows (lib/carinfo.js#getFuelSpecs). Coverage is patchy (pre-1984
// cars, rare makes), so a miss just means that tile doesn't render.
async function vehicleTiles(make, model, latestYear) {
  const specs = await carinfo.getFuelSpecs(make, model, latestYear);
  return {
    bodyClass: (specs && specs.type) || null,
    drive: (specs && specs.drive) || null,
    fuel: (specs && specs.fuel) || null
  };
}

let cached = { day: null, car: null, at: 0 };

async function getPuzzleCar(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (cached.day === day && (cached.car || Date.now() - cached.at < EMPTY_RETRY_MS)) return cached.car;

  const { fn, literal } = db.Sequelize;
  const candidates = await db.car.findAll({
    attributes: ['id', 'make', 'model', 'year_min', 'year_max'],
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
    decade: decadeOf(pick.year_min),
    ...await vehicleTiles(pick.make, pick.model, pick.year_max)
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
// Martin) rule out splitting the text, so the whole "make model" name is
// compared, normalised the same way on both sides: trimmed, lower-cased,
// whitespace runs collapsed.
async function findGuessCar(text) {
  const wanted = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!wanted) return null;
  const { fn, col, literal, where } = db.Sequelize;
  const name = fn('lower', fn('btrim', fn('regexp_replace', fn('concat', col('make'), literal("' '"), col('model')), '\\s+', ' ', 'g')));
  return db.car.findOne({
    attributes: ['id', 'make', 'model', 'year_min', 'year_max'],
    where: { ...eligibleWhere(), [Op.and]: [where(name, wanted)] }
  });
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

// Categorical tiles (body class, drive, fuel) have no "close" — only exact,
// wrong, or unknown when either side has no FuelEconomy.gov data.
function tileState(guessValue, answerValue) {
  if (!guessValue || !answerValue) return 'unknown';
  return guessValue === answerValue ? 'exact' : 'wrong';
}

// Score one guess against the answer. `guess` and `answer` both carry
// make/country/decade (getPuzzleCar's shape; a resolved guess car is turned
// into the same shape by the caller). Async: the guess's body class, drive
// and fuel come from a fresh FuelEconomy.gov lookup (cached by lib/cache.js).
async function compareGuess(guess, answer) {
  const guessDecade = decadeOf(guess.year_min);
  const diff = Math.abs(guessDecade - answer.decade);
  const tiles = await vehicleTiles(guess.make, guess.model, guess.year_max);
  return {
    make: guess.make,
    model: guess.model,
    makeState: guess.make === answer.make ? 'exact' : 'wrong',
    countryState: getMakeCountry(guess.make) === answer.country ? 'exact' : 'wrong',
    country: getMakeCountry(guess.make),
    decade: guessDecade,
    decadeState: diff === 0 ? 'exact' : (diff <= 10 ? 'close' : 'wrong'),
    decadeDirection: guessDecade === answer.decade ? null : (guessDecade < answer.decade ? 'higher' : 'lower'),
    bodyClass: tiles.bodyClass,
    bodyClassState: tileState(tiles.bodyClass, answer.bodyClass),
    drive: tiles.drive,
    driveState: tileState(tiles.drive, answer.drive),
    fuel: tiles.fuel,
    fuelState: tileState(tiles.fuel, answer.fuel)
  };
}

module.exports = {
  MAX_GUESSES, getPuzzleCar, clearPuzzleCache, findGuessCar, suggestGuesses, compareGuess, decadeOf
};
