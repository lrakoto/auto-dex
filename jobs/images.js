// Unsplash image updater: fills in placeholder car images, 50 cars per run,
// priority makes first. Started from server.js (web process) for now —
// set ENABLE_BACKGROUND_JOBS=false when this moves to a separate cron.
const axios = require('axios');
const db = require('../models');
const { PLACEHOLDER_URL } = require('../lib/constants');

const uSplashKey = process.env.UKEY;
const uSplashBaseURL = 'https://api.unsplash.com/';
const uSplashEnd = `client_id=${uSplashKey}`;

const PRIORITY_MAKES = [
  'Tesla', 'Subaru', 'Mitsubishi', 'Chrysler', 'Nissan', 'Audi', 'Toyota', 'Mercedes-Benz',
  'BMW', 'Volkswagen', 'Porsche', 'Ferrari', 'Lamborghini', 'McLaren', 'Bugatti',
  'Rolls-Royce', 'Bentley', 'Maserati', 'Pagani', 'Aston Martin',
  'Renault', 'Peugeot', 'Citroën', 'Volvo', 'Saab', 'Lotus',
  'Jaguar', 'Land Rover', 'Alfa Romeo', 'Fiat', 'Lancia',
  'Mazda', 'Honda', 'Hyundai', 'Kia', 'Genesis', 'Suzuki', 'Isuzu', 'Daihatsu',
];

async function unsplashImages() {
  try {
    // First pass: priority makes. Second pass: everything else.
    let carimg = await db.car.findAll({
      where: { updated_img: false, make: PRIORITY_MAKES }
    });
    if (carimg.length === 0) {
      carimg = await db.car.findAll({ where: { updated_img: false } });
    }
    if (carimg.length === 0) {
      console.log('All images up to date.');
      return;
    }

    const batch = carimg.slice(0, 50);
    for (let car of batch) {
      let index = car.dataValues;
      try {
        let getCarImage = await axios.get(
          `${uSplashBaseURL}search/photos?orientation=landscape&page=1&per_page=1&query=${index.make.replaceAll(' ', '+')}+${index.model.replaceAll(' ', '+')}&${uSplashEnd}`
        );
        let results = getCarImage.data.results;
        let imgURL = results && results.length > 0
          ? results[0].urls.full
          : PLACEHOLDER_URL;
        await db.car.update(
          { updated_img: true, image: imgURL },
          { where: { make: index.make, model: index.model } }
        );
        console.log(`Image updated: ${index.make} ${index.model}`);
      } catch (err) {
        console.log(`UNSPLASH ERROR for ${index.make} ${index.model}:`, err.message);
        await db.car.update(
          { updated_img: true, image: PLACEHOLDER_URL },
          { where: { make: index.make, model: index.model } }
        );
      }
    }
    console.log(`IMAGES ADDED: ${batch.length} processed`);
  } catch (err) {
    console.log('ERROR in unsplashImages:', err);
  }
}

module.exports = { unsplashImages };
