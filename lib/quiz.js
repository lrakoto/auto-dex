// "Who's That Car?" — name the car in a catalog photo from four choices.
// Rounds are plain ids ({ answer, choices }) kept in the session by
// controllers/play.js; the answer never reaches the page until it's guessed.
const db = require('../models');
const { MAKES_LIST, getMakeCountry } = require('../config/carquery');
const { photoPoolWhere, filterListed } = require('./catalog');
const { photoCredit } = require('./photos');

const { Op } = db.Sequelize;

const CHOICES = 4;
const RECENT_LIMIT = 30; // a car won't be the answer again within this many rounds

// Decoys from the answer's own make as the streak grows: none at first, one
// from a streak of 3, two from 6, and from 9 every choice is the same make.
function sameMakeDecoys(streak) {
  return Math.min(CHOICES - 1, Math.floor((streak || 0) / 3));
}

// "Civic" and "Civic Type R" would both be right for the same photo
function confusable(a, b) {
  const first = s => s.toLowerCase().split(/[\s-]+/)[0];
  return a.make === b.make && first(a.model) === first(b.model);
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCars(where, limit) {
  return db.car.findAll({
    attributes: ['id', 'make', 'model', 'image'],
    where,
    order: db.sequelize.random(),
    limit
  });
}

async function pickAnswer(recent) {
  const candidates = await randomCars(photoPoolWhere(recent.length ? { id: { [Op.notIn]: recent } } : {}), 8);
  const [answer] = await filterListed(candidates);
  return answer || null;
}

async function pickDecoys(answer, streak) {
  const country = getMakeCountry(answer.make);
  const otherMakes = MAKES_LIST.filter(m => m !== answer.make);
  const countryMakes = otherMakes.filter(m => getMakeCountry(m) === country);
  const sameMake = sameMakeDecoys(streak);

  const pools = await Promise.all([
    randomCars(photoPoolWhere({ makes: [answer.make], id: { [Op.ne]: answer.id } }), sameMake * 3 + 3),
    countryMakes.length ? randomCars(photoPoolWhere({ makes: countryMakes }), 6) : [],
    randomCars(photoPoolWhere({ makes: otherMakes }), 12)
  ]);
  const listed = new Set((await filterListed(pools.flat())).map(c => c.id));
  const [fromMake, fromCountry, fromAnywhere] = pools.map(pool => pool.filter(c => listed.has(c.id)));

  const picked = [];
  function take(pool, n) {
    for (const car of pool) {
      if (n <= 0 || picked.length >= CHOICES - 1) return;
      if ([answer, ...picked].some(c => c.id === car.id || confusable(c, car))) continue;
      picked.push(car);
      n--;
    }
  }
  take(fromMake, sameMake);
  take(fromCountry, 1); // one from the same country, so the origin doesn't give it away
  take(fromAnywhere, CHOICES - 1);
  // Small catalogs: fill from whatever's left
  take(fromCountry, CHOICES - 1);
  take(fromMake, CHOICES - 1);
  return picked;
}

// A new round for this session state, or null when the catalog doesn't have
// enough photos yet. Records the answer in state.recent.
async function newRound(state) {
  const recent = state.recent || [];
  // A small catalog can run out of cars not seen lately: allow repeats then
  const answer = await pickAnswer(recent) || (recent.length ? await pickAnswer([]) : null);
  if (!answer) return null;
  const decoys = await pickDecoys(answer, state.streak);
  if (decoys.length < CHOICES - 1) return null;
  state.recent = [...recent, answer.id].slice(-RECENT_LIMIT);
  return { answer: answer.id, choices: shuffle([answer, ...decoys]).map(c => c.id) };
}

// What the page shows for a round: the photo and the four names, never which
// one is right. Null if a car in it has since left the catalog.
async function roundView(round) {
  if (!round) return null;
  const cars = await db.car.findAll({ attributes: ['id', 'make', 'model', 'image'], where: { id: round.choices } });
  const byId = new Map(cars.map(c => [c.id, c]));
  const answer = byId.get(round.answer);
  if (!answer || round.choices.some(id => !byId.has(id))) return null;
  const heroRow = await db.car_image.findOne({ where: { carId: answer.id, url: answer.image } });
  return {
    image: answer.image,
    credit: photoCredit(answer.image, heroRow, { linkSource: false }), // a Commons file name would give it away
    choices: round.choices.map(id => ({ id, label: `${byId.get(id).make} ${byId.get(id).model}` }))
  };
}

// Keep a signed-in player's record. Raw SQL so the row's updatedAt and
// validators aren't touched on every correct answer.
async function saveBest(userId, streak) {
  await db.sequelize.query(
    'UPDATE users SET "quizBest" = :streak WHERE id = :id AND "quizBest" < :streak',
    { replacements: { id: userId, streak } }
  );
}

// Best streaks among public garages — the only players with a public name
function getLeaders(limit = 10) {
  return db.user.findAll({
    attributes: ['username', 'name', 'quizBest'],
    where: { garagePublic: true, username: { [Op.ne]: null }, quizBest: { [Op.gt]: 0 } },
    order: [['quizBest', 'DESC'], ['id', 'ASC']],
    limit
  });
}

module.exports = { newRound, roundView, saveBest, getLeaders, sameMakeDecoys, confusable, CHOICES };
