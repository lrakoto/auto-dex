// Catalog photo updater, hourly. First the lead photo of each car's Wikipedia
// article (lib/wikimedia.js), which becomes the hero unless people picked
// another one. Then Unsplash, as the fallback for cars Wikipedia had nothing
// for: fills in placeholder images, priority makes first, and spends any
// leftover request budget crediting photographers on older Unsplash images
// that predate credits. Started from server.js (web process) — set
// ENABLE_BACKGROUND_JOBS=false when this moves to a separate cron.
const db = require('../models');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { addImage } = require('../lib/gallery');
const carquery = require('../config/carquery');
const unsplash = require('../lib/unsplash');
const wikimedia = require('../lib/wikimedia'); // via the module so tests can stub it

const PRIORITY_MAKES = [
  'Tesla', 'Subaru', 'Mitsubishi', 'Chrysler', 'Nissan', 'Audi', 'Toyota', 'Mercedes-Benz',
  'BMW', 'Volkswagen', 'Porsche', 'Ferrari', 'Lamborghini', 'McLaren', 'Bugatti',
  'Rolls-Royce', 'Bentley', 'Maserati', 'Pagani', 'Aston Martin',
  'Renault', 'Peugeot', 'Citroën', 'Volvo', 'Saab', 'Lotus',
  'Jaguar', 'Land Rover', 'Alfa Romeo', 'Fiat', 'Lancia',
  'Mazda', 'Honda', 'Hyundai', 'Kia', 'Genesis', 'Suzuki', 'Isuzu', 'Daihatsu',
];

// Search requests per hourly run. The Unsplash demo tier allows 50/hour.
const BATCH_SIZE = 45;

// Cars looked up on Wikipedia per hourly run: a few cached requests each,
// spaced out, so the whole catalog takes about a day on the first pass.
const WIKI_BATCH = 150;
const WIKI_DELAY_MS = 500;

// Photos the jobs chose, as opposed to people (proposals, admin uploads)
const AUTOMATED_SOURCES = ['unsplash', 'catalog'];

// Add the Wikipedia photo to the gallery. It becomes the hero when the
// current one was picked automatically (placeholder, Unsplash) and no photo
// has votes; otherwise it waits in the gallery for votes.
async function addWikipediaPhoto(car, photo) {
  const { Op } = db.Sequelize;
  const image = await addImage(car.id, photo.url, {
    source: 'wikimedia',
    creditName: photo.creditName,
    creditUrl: photo.creditUrl,
    license: photo.license,
    licenseUrl: photo.licenseUrl
  });
  const current = await db.car.findByPk(car.id, { attributes: ['id', 'image', 'updated_img'] });
  if (!current || current.image === photo.url || image.score < 0) return;
  const heroRow = current.image ? await db.car_image.findOne({ where: { carId: car.id, url: current.image } }) : null;
  const automatedHero = !current.updated_img || !current.image || current.image === PLACEHOLDER_URL
    || (heroRow ? AUTOMATED_SOURCES.includes(heroRow.source) : unsplash.isUnsplashUrl(current.image));
  const outvoted = await db.car_image.count({ where: { carId: car.id, score: { [Op.gt]: image.score } } });
  if (automatedHero && !outvoted) {
    await db.car.update({ image: photo.url, updated_img: true }, { where: { id: car.id } });
  }
}

// Look up the next batch of catalog cars on Wikipedia: placeholders first,
// then the most favourited. A failed lookup (Wikipedia down, throttled) is
// retried next run; three in a row end this run.
async function wikipediaPhotos(budget = WIKI_BATCH, { delayMs = WIKI_DELAY_MS } = {}) {
  const cars = await db.car.findAll({
    attributes: ['id', 'make', 'model', 'year_max'],
    where: { wiki_checked: false, make: carquery.ALL_MAKES },
    order: [['updated_img', 'ASC'], ['favcount', 'DESC'], ['id', 'ASC']],
    limit: budget
  });
  let found = 0;
  let failures = 0;
  for (const car of cars) {
    try {
      const photo = await wikimedia.findLeadPhoto(car.make, car.model, { yearMax: car.year_max });
      failures = 0;
      if (photo) {
        await addWikipediaPhoto(car, photo);
        found++;
      }
      await db.car.update({ wiki_checked: true }, { where: { id: car.id } });
    } catch (err) {
      console.log(`Wikipedia photo error for ${car.make} ${car.model} (retried next run):`, err.message);
      if (++failures >= 3) break;
    }
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  if (cars.length) console.log(`Wikipedia photos: ${found} found for ${cars.length} cars`);
  return cars.length;
}

// Unsplash only searches for cars Wikipedia has already been asked about
async function fillPlaceholders(budget) {
  // First pass: cars of the priority makes (Honda and BMW motorcycles wait).
  // Second pass: everything else.
  const { Op } = db.Sequelize;
  let cars = await db.car.findAll({
    where: {
      updated_img: false,
      wiki_checked: true,
      make: PRIORITY_MAKES,
      [Op.or]: [{ vehicle_type: 'car' }, { vehicle_type: null }]
    },
    limit: budget
  });
  if (cars.length === 0) {
    cars = await db.car.findAll({ where: { updated_img: false, wiki_checked: true }, limit: budget });
  }

  for (const car of cars) {
    try {
      const photo = await unsplash.searchCarPhoto(car.make, car.model);
      if (!photo) {
        await db.car.update({ updated_img: true, image: PLACEHOLDER_URL }, { where: { id: car.id } });
        continue;
      }
      // Goes into the gallery too, so users can vote it down if it's the wrong car
      await addImage(car.id, unsplash.sizedUrl(photo.urls.full), {
        source: 'unsplash',
        makeHero: true,
        ...unsplash.creditFor(photo)
      });
      await unsplash.trackDownload(photo);
      console.log(`Image updated: ${car.make} ${car.model}`);
    } catch (err) {
      console.log(`UNSPLASH ERROR for ${car.make} ${car.model}:`, err.message);
      if (err.response && err.response.status === 403) break; // rate limited — stop for this hour
      await db.car.update({ updated_img: true, image: PLACEHOLDER_URL }, { where: { id: car.id } });
    }
  }
  return cars.length;
}

// Older Unsplash images were stored without the photo record, so there's no
// photographer to credit. Re-run the same search the image came from and, if
// the top result is still that photo, record the credit.
async function backfillCredits(budget) {
  if (budget <= 0) return 0;
  const images = await db.car_image.findAll({
    where: {
      credit_checked: false,
      source: ['catalog', 'unsplash'],
      url: { [db.Sequelize.Op.like]: 'https://images.unsplash.com/%' }
    },
    include: [{ model: db.car, attributes: ['make', 'model'] }],
    limit: budget
  });
  let credited = 0;
  for (const image of images) {
    try {
      const photo = await unsplash.searchCarPhoto(image.car.make, image.car.model);
      const match = photo && unsplash.samePhoto(photo.urls.full, image.url);
      const credit = match ? unsplash.creditFor(photo) : {};
      await image.update({
        credit_name: credit.creditName || null,
        credit_url: credit.creditUrl || null,
        credit_checked: true
      });
      if (match) credited++;
    } catch (err) {
      if (err.response && err.response.status === 403) break;
      console.log(`Credit backfill error for image ${image.id}:`, err.message);
    }
  }
  console.log(`Credits: ${credited}/${images.length} older Unsplash images credited`);
  return images.length;
}

async function unsplashImages() {
  if (!process.env.UKEY) {
    console.log('Unsplash: UKEY not set, skipping.');
    return;
  }
  try {
    const used = await fillPlaceholders(BATCH_SIZE);
    if (used === 0) console.log('All images up to date.');
    await backfillCredits(BATCH_SIZE - used);
  } catch (err) {
    console.log('ERROR in unsplashImages:', err);
  }
}

// The hourly run: Wikipedia first, then Unsplash for what it couldn't cover
async function updatePhotos() {
  try {
    await wikipediaPhotos();
  } catch (err) {
    console.log('ERROR in wikipediaPhotos:', err);
  }
  await unsplashImages();
}

module.exports = { updatePhotos, wikipediaPhotos, addWikipediaPhoto, unsplashImages, backfillCredits, BATCH_SIZE, WIKI_BATCH };
