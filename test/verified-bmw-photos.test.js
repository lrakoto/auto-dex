const assert = require('node:assert/strict');
const db = require('../models');
const gallery = require('../lib/gallery');
const images = require('../jobs/images');

const commons = 'https://upload.wikimedia.org/wikipedia/commons/';
const thumb = (hash, file) => commons + 'thumb/' + hash + '/' + file + '/1280px-' + file;
const wrong528File = 'BMW_550i_%28F10%29_%E2%80%93_Frontansicht_%282%29%2C_17._Juli_2011%2C_Mettmann.jpg';
const wrong528 = thumb('9/93', wrong528File);
const right528File = '2000_BMW_528i_Sedan_in_Jet_Black%2C_Front_Left%2C_07-12-2023.jpg';
const right528 = thumb('f/ff', right528File);
const wrong750 = thumb('c/c1', 'BMW_730i_%28E32%29_registered_August_1990_2986cc.jpg');
const right750 = thumb('c/cc', 'BMW_750iL.jpg');
const manual750 = 'https://example.test/owner-chosen-750il.jpg';

describe('Verified BMW catalog photos', function() {
  it('corrects only known wrong covers while keeping gallery history and votes', async function() {
    const cars = await db.car.bulkCreate([
      { make: 'BMW', model: '528i', image: wrong528 },
      { make: 'BMW', model: '750iL', image: manual750 },
      { make: 'BMW', model: '550i', image: wrong528 },
      { make: 'BMW', model: '730i', image: wrong750 }
    ].map(car => ({ ...car, updated_img: true, wiki_checked: true, favcount: 0 })));
    const [fiveSeries, sevenSeries, real550, real730] = cars;
    const galleryImage = (car, url) => db.car_image.findOne({ where: { carId: car.id, url } });
    let voter;
    try {
      voter = await db.user.create({
        name: 'BMW photo voter',
        email: 'verified-bmw-photo-voter@example.test',
        password: 'bmw-photo-fixture-password'
      });
      const wrong = await db.car_image.create({
        carId: fiveSeries.id, url: wrong528, source: 'wikimedia',
        score: 1, credit_name: 'Original photographer', license: 'Original license'
      });
      const retainedVote = await db.car_image_vote.create({ imageId: wrong.id, userId: voter.id, value: 1 });
      await db.car_image.bulkCreate([
        { carId: sevenSeries.id, url: manual750, source: 'admin' },
        { carId: real550.id, url: wrong528, source: 'wikimedia' },
        { carId: real730.id, url: wrong750, source: 'wikimedia' }
      ]);

      await images.applyVerifiedCatalogPhotos();

      assert.equal((await fiveSeries.reload()).image, right528);
      const corrected = await galleryImage(fiveSeries, right528);
      assert.ok(corrected);
      assert.equal(corrected.source, 'wikimedia');
      assert.equal(corrected.credit_name, 'Elise240SX');
      assert.equal(decodeURIComponent(corrected.credit_url), 'https://commons.wikimedia.org/wiki/File:' + decodeURIComponent(right528File));
      assert.equal(corrected.license, 'CC BY-SA 4.0');
      assert.equal(corrected.license_url, 'https://creativecommons.org/licenses/by-sa/4.0/');
      assert.equal((await sevenSeries.reload()).image, manual750);
      assert.equal(await galleryImage(sevenSeries, right750), null);
      for (const [car, url] of [[real550, wrong528], [real730, wrong750]]) {
        assert.equal((await car.reload()).image, url);
        assert.deepEqual((await gallery.getGallery(car, voter.id)).map(photo => photo.url), [url]);
      }

      assert.deepEqual((await gallery.getGallery(fiveSeries, voter.id)).map(photo => photo.url), [right528]);
      const result = await gallery.vote(corrected.id, voter.id, -1);
      assert.equal(result.heroUrl, right528, 'the more popular mismatch cannot reclaim the cover');
      assert.equal(await gallery.vote(wrong.id, voter.id, -1), null);
      await wrong.reload();
      assert.equal(wrong.url, wrong528);
      assert.equal(wrong.score, 1);
      assert.equal(wrong.credit_name, 'Original photographer');
      assert.equal(wrong.license, 'Original license');
      assert.equal((await retainedVote.reload()).value, 1);

      const originalWrong = commons + '9/93/' + decodeURIComponent(wrong528File);
      await images.addWikipediaPhoto(await fiveSeries.reload(), { url: originalWrong });
      assert.equal(await galleryImage(fiveSeries, originalWrong), null);

      await sevenSeries.update({ image: wrong750 });
      await images.applyVerifiedCatalogPhotos();

      assert.equal((await sevenSeries.reload()).image, right750);
      const credited = await galleryImage(sevenSeries, right750);
      assert.ok(credited);
      assert.equal(credited.source, 'wikimedia');
      assert.equal(credited.credit_name, 'TTTNIS');
      assert.equal(credited.credit_url, 'https://commons.wikimedia.org/wiki/File:BMW_750iL.jpg');
      assert.equal(credited.license, 'Public domain');
      assert.equal(credited.license_url, 'https://commons.wikimedia.org/wiki/File:BMW_750iL.jpg#Licensing');
      assert.ok(await galleryImage(sevenSeries, manual750));
      assert.equal((await galleryImage(fiveSeries, right528)).id, corrected.id);
      assert.equal(await db.car_image.count({ where: { carId: fiveSeries.id } }), 2);
    } finally {
      await db.car.destroy({ where: { id: cars.map(car => car.id) } });
      if (voter) await voter.destroy();
    }
  });
});
