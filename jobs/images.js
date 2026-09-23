// Unsplash image updater: fills in placeholder car images, priority makes
// first, then spends any leftover request budget crediting photographers on
// older Unsplash images that predate credits. Started from server.js (web
// process) — set ENABLE_BACKGROUND_JOBS=false when this moves to a separate cron.
const db = require('../models');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { addImage } = require('../lib/gallery');
const unsplash = require('../lib/unsplash');

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

async function fillPlaceholders(budget) {
  // First pass: priority makes. Second pass: everything else.
  let cars = await db.car.findAll({
    where: { updated_img: false, make: PRIORITY_MAKES },
    limit: budget
  });
  if (cars.length === 0) {
    cars = await db.car.findAll({ where: { updated_img: false }, limit: budget });
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

module.exports = { unsplashImages, backfillCredits };
