// Hourly Commons-only catalog photo updater. Unsplash URLs remain stored as
// history, but are hidden immediately and queued for model-matched replacement.
// ENABLE_BACKGROUND_JOBS=false disables the scheduler when using separate cron.
const db = require('../models');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { addImage } = require('../lib/gallery');
const { isRetiredPhoto, RETIRED_PHOTO_PATTERN } = require('../lib/photoPolicy');
const carquery = require('../config/carquery');
const wikimedia = require('../lib/wikimedia'); // via the module so tests can stub it

const WIKI_BATCH = 150;
// Work through the one-time retirement backlog sooner without increasing
// request concurrency or changing the normal maintenance cadence.
const WIKI_RETIREMENT_BATCH = 500;
const WIKI_DELAY_MS = 500;
const WIKI_RECHECK_DAYS = 30;
// One fixed rollout boundary makes every existing Unsplash hero eligible once,
// even if Wikipedia was checked recently. A miss is then stamped normally and
// waits 30 days, so unmatchable models cannot monopolize every hourly batch.
const UNSPLASH_RETIREMENT_AT = new Date('2026-10-15T22:55:00Z');
// Retry only the newly supported exact names once, without making recent
// misses wait a month or replacing a cover somebody already chose.
const PHOTO_ALIAS_RECHECK_AT = new Date('2026-10-15T23:28:00Z');

function retirementPendingWhere() {
  const { Op } = db.Sequelize;
  return {
    image: { [Op.iRegexp]: RETIRED_PHOTO_PATTERN },
    [Op.or]: [{ wiki_checked_at: null }, { wiki_checked_at: { [Op.lt]: UNSPLASH_RETIREMENT_AT } }]
  };
}

async function addWikipediaPhoto(car, photo) {
  const { Op } = db.Sequelize;
  const image = await addImage(car.id, photo.url, {
    source: 'wikimedia',
    creditName: photo.creditName,
    creditUrl: photo.creditUrl,
    license: photo.license,
    licenseUrl: photo.licenseUrl
  });
  if (!image) return;
  const current = await db.car.findByPk(car.id, { attributes: ['id', 'image', 'updated_img'] });
  if (!current || current.image === photo.url || image.score < 0) return;
  const rawHero = current.getDataValue('image');
  // Retired stock imagery is replaced regardless of its historical votes.
  if (isRetiredPhoto(rawHero)) {
    await db.car.update({ image: photo.url, updated_img: true }, { where: { id: car.id } });
    return;
  }
  const heroRow = rawHero ? await db.car_image.findOne({ where: { carId: car.id, url: rawHero } }) : null;
  const automatedHero = !current.updated_img || !rawHero || rawHero === PLACEHOLDER_URL
    || (heroRow && ['catalog', 'unsplash'].includes(heroRow.source));
  const outvoted = await db.car_image.count({ where: {
    carId: car.id,
    source: { [Op.ne]: 'unsplash' },
    url: { [Op.notIRegexp]: RETIRED_PHOTO_PATTERN },
    score: { [Op.gt]: image.score }
  } });
  if (automatedHero && !outvoted) {
    await db.car.update({ image: photo.url, updated_img: true }, { where: { id: car.id } });
  }
}

async function wikipediaPhotos(budget = WIKI_BATCH, { delayMs = WIKI_DELAY_MS } = {}) {
  const { Op } = db.Sequelize;
  const recheckBefore = new Date(Date.now() - WIKI_RECHECK_DAYS * 24 * 60 * 60 * 1000);
  const retirementPending = retirementPendingWhere();
  const aliasNames = wikimedia.PHOTO_ALIASES.map(({ make, model }) => ({ make, model }));
  const aliasPending = {
    [Op.and]: [
      { [Op.or]: aliasNames },
      { [Op.or]: [{ image: null }, { image: '' }, { image: PLACEHOLDER_URL }, { image: { [Op.iRegexp]: RETIRED_PHOTO_PATTERN } }] },
      { [Op.or]: [{ wiki_checked_at: null }, { wiki_checked_at: { [Op.lt]: PHOTO_ALIAS_RECHECK_AT } }] }
    ]
  };
  const aliasNamesSql = aliasNames.map(({ make, model }) => `("car"."make" = ${db.sequelize.escape(make)} AND "car"."model" = ${db.sequelize.escape(model)})`).join(' OR ');
  const aliasPendingSql = `(${aliasNamesSql}) AND ("car"."image" IS NULL OR "car"."image" IN ('', ${db.sequelize.escape(PLACEHOLDER_URL)}) OR "car"."image" ~* ${db.sequelize.escape(RETIRED_PHOTO_PATTERN)}) AND ("car"."wiki_checked_at" IS NULL OR "car"."wiki_checked_at" < ${db.sequelize.escape(PHOTO_ALIAS_RECHECK_AT)})`;
  const cars = await db.car.findAll({
    attributes: ['id', 'make', 'model', 'year_max', 'model_years'],
    where: {
      [Op.or]: [
        aliasPending,
        retirementPending,
        {
          image: { [Op.iRegexp]: RETIRED_PHOTO_PATTERN },
          wiki_checked_at: { [Op.lt]: recheckBefore }
        },
        {
          make: carquery.ALL_MAKES,
          [Op.or]: [
            { wiki_checked: false },
            {
              wiki_checked_at: { [Op.lt]: recheckBefore },
              [Op.and]: db.sequelize.literal('NOT EXISTS (SELECT 1 FROM car_images ci WHERE ci."carId" = "car"."id" AND ci.source = \'wikimedia\')')
            }
          ]
        }
      ]
    },
    order: [[db.sequelize.literal(`CASE WHEN ${aliasPendingSql} THEN 0 WHEN "car"."image" ~* ${db.sequelize.escape(RETIRED_PHOTO_PATTERN)} AND ("car"."wiki_checked_at" IS NULL OR "car"."wiki_checked_at" < ${db.sequelize.escape(UNSPLASH_RETIREMENT_AT)}) THEN 1 ELSE 2 END`), 'ASC'],
      ['wiki_checked', 'ASC'], ['updated_img', 'ASC'], ['favcount', 'DESC'], ['id', 'ASC']],
    limit: budget
  });
  let found = 0;
  let failures = 0;
  let attempted = 0;
  for (const car of cars) {
    attempted++;
    try {
      const photo = await wikimedia.findLeadPhoto(car.make, car.model, { yearMax: car.year_max, modelYears: car.model_years });
      failures = 0;
      if (photo) {
        await addWikipediaPhoto(car, photo);
        found++;
      }
      await db.car.update({ wiki_checked: true, wiki_checked_at: new Date() }, { where: { id: car.id } });
    } catch (err) {
      console.log(`Wikipedia photo error for ${car.make} ${car.model} (retried next run):`, err.message);
      if (++failures >= 3) break;
    }
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  if (cars.length) console.log(`Wikipedia photos: ${found} found for ${attempted} cars attempted (${cars.length} selected)`);
  return cars.length;
}

// Compatibility exports for older scripts. They deliberately perform no API
// requests and cannot reintroduce Unsplash images or mutate their history.
async function unsplashImages() { return 0; }
async function backfillCredits() { return 0; }
const BATCH_SIZE = 0;

async function updatePhotos({ delayMs = WIKI_DELAY_MS } = {}) {
  try {
    const pendingRetirement = await db.car.findOne({ attributes: ['id'], where: retirementPendingWhere() });
    await wikipediaPhotos(pendingRetirement ? WIKI_RETIREMENT_BATCH : WIKI_BATCH, { delayMs });
  } catch (err) {
    console.log('ERROR in wikipediaPhotos:', err);
  }
}

module.exports = {
  updatePhotos, wikipediaPhotos, addWikipediaPhoto, unsplashImages, backfillCredits,
  BATCH_SIZE, WIKI_BATCH, WIKI_RETIREMENT_BATCH, WIKI_RECHECK_DAYS, UNSPLASH_RETIREMENT_AT, PHOTO_ALIAS_RECHECK_AT
};
