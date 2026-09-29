// Car of the Day: one catalog car with a real photo, picked by hashing its id
// with the date, so every visitor gets the same car all day and it changes at
// midnight UTC — no table, no job.
const db = require('../models');
const { getMakeCountry } = require('../config/carquery');
const { photoPoolWhere, filterListed } = require('./catalog');
const { formatYears } = require('./carinfo');
const { photoCredit } = require('./photos');

const EMPTY_RETRY_MS = 10 * 60 * 1000; // an empty catalog is re-checked soon

let cached = { day: null, car: null, at: 0 };

async function getCarOfTheDay(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (cached.day === day && (cached.car || Date.now() - cached.at < EMPTY_RETRY_MS)) return cached.car;

  const { fn, literal } = db.Sequelize;
  const candidates = await db.car.findAll({
    where: photoPoolWhere(),
    order: [[fn('md5', literal(`"car"."id"::text || ${db.sequelize.escape(day)}`)), 'ASC']],
    limit: 8
  });
  const [pick] = await filterListed(candidates);

  let result = null;
  if (pick) {
    const heroRow = await db.car_image.findOne({ where: { carId: pick.id, url: pick.image } });
    result = {
      make: pick.make,
      model: pick.model,
      image: pick.image,
      favcount: pick.favcount || 0,
      years: formatYears(pick),
      country: getMakeCountry(pick.make),
      credit: photoCredit(pick.image, heroRow)
    };
  }
  cached = { day, car: result, at: Date.now() };
  return result;
}

function clearDailyCache() {
  cached = { day: null, car: null, at: 0 };
}

module.exports = { getCarOfTheDay, clearDailyCache };
