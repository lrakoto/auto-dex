const assert = require('node:assert/strict');
const db = require('../models');
const gallery = require('../lib/gallery');
const images = require('../jobs/images');
const wikimedia = require('../lib/wikimedia');
const { PLACEHOLDER_URL } = require('../lib/constants');

const commons = 'https://upload.wikimedia.org/wikipedia/commons/';
const thumb = (hash, file) => commons + 'thumb/' + hash + '/' + file + '/1280px-' + file;
const wrong528File = 'BMW_550i_%28F10%29_%E2%80%93_Frontansicht_%282%29%2C_17._Juli_2011%2C_Mettmann.jpg';
const wrong528 = thumb('9/93', wrong528File);
const right528File = '2000_BMW_528i_Sedan_in_Jet_Black%2C_Front_Left%2C_07-12-2023.jpg';
const right528 = thumb('f/ff', right528File);
const right528xi = thumb('a/a6', 'BMW_528xi_sedan.jpg');
const credit528xi = 'https://commons.wikimedia.org/wiki/File:BMW_528xi_sedan.jpg';
const wrong750 = thumb('c/c1', 'BMW_730i_%28E32%29_registered_August_1990_2986cc.jpg');
const right750 = thumb('c/cc', 'BMW_750iL.jpg');
const manual750 = 'https://example.test/owner-chosen-750il.jpg';
const xDrive = { make: 'BMW', model: '528i xDrive' };
const xDrivePhoto = thumb('8/8d', '2016_BMW_528i_xDrive.jpg');
const xDriveCredit = 'https://commons.wikimedia.org/wiki/File:2016_BMW_528i_xDrive.jpg';

describe('Verified BMW catalog photos', function() {
  it('corrects only known wrong covers while keeping gallery history and votes', async function() {
    const cars = await db.car.bulkCreate([
      { make: 'BMW', model: '528i', image: wrong528 },
      { make: 'BMW', model: '528xi', image: wrong528 },
      { make: 'BMW', model: '750iL', image: manual750 },
      { make: 'BMW', model: '550i', image: wrong528 },
      { make: 'BMW', model: '730i', image: wrong750 }
    ].map(car => ({ ...car, updated_img: true, wiki_checked: true, favcount: 0 })));
    const [fiveSeries, allWheelDrive, sevenSeries, real550, real730] = cars;
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
      const [wrongAllWheelDrive] = await db.car_image.bulkCreate([
        { carId: allWheelDrive.id, url: wrong528, source: 'wikimedia', score: 1 },
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

      assert.equal((await allWheelDrive.reload()).image, right528xi);
      const correctedAllWheelDrive = await galleryImage(allWheelDrive, right528xi);
      assert.ok(correctedAllWheelDrive);
      assert.equal(correctedAllWheelDrive.source, 'wikimedia');
      assert.equal(correctedAllWheelDrive.credit_name, 'IFCAR');
      assert.equal(correctedAllWheelDrive.credit_url, credit528xi);
      assert.equal(correctedAllWheelDrive.license, 'Public domain');
      assert.equal(correctedAllWheelDrive.license_url, credit528xi + '#Licensing');
      assert.deepEqual((await gallery.getGallery(allWheelDrive, voter.id)).map(photo => photo.url), [right528xi]);
      assert.equal((await gallery.vote(correctedAllWheelDrive.id, voter.id, -1)).heroUrl, right528xi);
      assert.equal(await gallery.vote(wrongAllWheelDrive.id, voter.id, -1), null);
      assert.equal((await wrongAllWheelDrive.reload()).score, 1);

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
      assert.equal((await galleryImage(allWheelDrive, right528xi)).id, correctedAllWheelDrive.id);
      assert.equal(await db.car_image.count({ where: { carId: allWheelDrive.id } }), 2);
      assert.equal(await db.car_image.count({ where: { carId: fiveSeries.id } }), 2);
    } finally {
      await db.car.destroy({ where: { id: cars.map(car => car.id) } });
      if (voter) await voter.destroy();
    }
  });

  it('replaces the 840Ci photo only on the 850CSi and keeps its gallery history', async function() {
    const oldFile = 'BMW_840_Ci_%287724204324%29_%28cropped%29.jpg';
    const oldPhoto = thumb('e/ec', oldFile);
    const verified = thumb('4/40', '1995_BMW_850_CSi.JPG');
    const credit = 'https://commons.wikimedia.org/wiki/File:1995_BMW_850_CSi.JPG';
    const cars = await db.car.bulkCreate(['850CSi', '840Ci'].map(model => ({
      make: 'BMW', model, image: oldPhoto, updated_img: true
    })));
    const [csi, ci] = cars;
    let voter;
    try {
      const [oldOnCsi] = await db.car_image.bulkCreate(cars.map(car => ({
        carId: car.id, url: oldPhoto, source: 'wikimedia', score: 1, credit_name: 'nakhon100'
      })));
      voter = await db.user.create({
        name: '850CSi fixture', email: '850csi-photo@example.test', password: '850csi-photo-fixture-password'
      });
      const oldVote = await db.car_image_vote.create({ imageId: oldOnCsi.id, userId: voter.id, value: 1 });

      await images.applyVerifiedCatalogPhotos();
      await images.applyVerifiedCatalogPhotos();

      assert.equal((await csi.reload()).image, verified);
      const [replacement, ...otherPhotos] = await gallery.getGallery(csi, voter.id);
      assert.deepEqual(otherPhotos, []);
      assert.equal(replacement.url, verified);
      assert.equal(replacement.credit_name, 'Jagvar');
      assert.equal(replacement.credit_url, credit);
      assert.equal(replacement.license, 'Public domain');
      assert.equal(replacement.license_url, credit + '#Licensing');
      assert.equal(await db.car_image.count({ where: { carId: csi.id } }), 2);
      assert.equal(await gallery.vote(oldOnCsi.id, voter.id, -1), null);
      assert.equal((await oldOnCsi.reload()).score, 1);
      assert.equal(oldOnCsi.credit_name, 'nakhon100');
      assert.equal((await oldVote.reload()).value, 1);

      const original = commons + 'e/ec/' + decodeURIComponent(oldFile);
      await images.addWikipediaPhoto(csi, { url: original });
      assert.equal(await db.car_image.findOne({ where: { carId: csi.id, url: original } }), null);
      assert.equal((await ci.reload()).image, oldPhoto);
      assert.deepEqual((await gallery.getGallery(ci)).map(photo => photo.url), [oldPhoto]);
    } finally {
      await db.car.destroy({ where: { id: cars.map(car => car.id) } });
      if (voter) await voter.destroy();
    }
  });

  it('fills only eligible missing xDrive covers and retains credited gallery rows and votes', async function() {
    const car = await db.car.create({ ...xDrive, image: null, wiki_checked: true, updated_img: null });
    let voter;
    try {
      const where = { carId: car.id, url: xDrivePhoto };
      await images.applyVerifiedCatalogPhotos();
      assert.equal((await car.reload()).getDataValue('image'), xDrivePhoto);
      const candidate = await db.car_image.findOne({ where });
      assert.ok(candidate);
      assert.equal(candidate.source, 'wikimedia');
      assert.equal(candidate.credit_name, 'DestinationFearFan');
      assert.equal(candidate.credit_url, xDriveCredit);
      assert.equal(candidate.license, 'CC BY-SA 4.0');
      assert.equal(candidate.license_url, 'https://creativecommons.org/licenses/by-sa/4.0/');

      voter = await db.user.create({
        name: 'xDrive photo voter', email: 'xdrive-photo-voter@example.test', password: 'xdrive-fixture-password'
      });
      await gallery.vote(candidate.id, voter.id, 1);
      const voteWhere = { imageId: candidate.id, userId: voter.id };
      const vote = await db.car_image_vote.findOne({ where: voteWhere });
      assert.ok(vote);

      for (const image of ['', PLACEHOLDER_URL]) {
        await car.update({ image, updated_img: false });
        await images.applyVerifiedCatalogPhotos();
        assert.equal((await car.reload()).getDataValue('image'), xDrivePhoto);
      }
      const saved = await candidate.reload();
      assert.equal(saved.score, 1);
      assert.equal(saved.credit_name, 'DestinationFearFan');
      assert.equal(saved.credit_url, xDriveCredit);
      assert.equal((await vote.reload()).value, 1);
      assert.equal(await db.car_image.count({ where: { carId: car.id } }), 1);

      await car.update({ image: PLACEHOLDER_URL, updated_img: true });
      await images.applyVerifiedCatalogPhotos();
      assert.equal((await car.reload()).getDataValue('image'), PLACEHOLDER_URL);

      const negativeVote = await gallery.vote(candidate.id, voter.id, -1);
      assert.equal(negativeVote.score, -1);
      await car.reload();
      await car.update({ image: PLACEHOLDER_URL, updated_img: false });
      await images.applyVerifiedCatalogPhotos();
      assert.equal((await car.reload()).getDataValue('image'), PLACEHOLDER_URL);
      assert.equal((await candidate.reload()).score, -1);
      assert.equal((await vote.reload()).value, -1);
    } finally {
      await car.destroy();
      if (voter) await voter.destroy();
    }
  });

  it('leaves a chosen xDrive cover in place during a fill and a later Wikimedia sweep', async function() {
    const car = await db.car.create({ ...xDrive, image: '', wiki_checked: false, updated_img: false });
    const chosen = 'https://example.test/chosen-xdrive-cover.jpg';
    const hook = 'choose-xdrive-cover-before-verified-update';
    let choseCover = false;
    const originalFindAll = db.car.findAll;
    const originalFindPhoto = wikimedia.findLeadPhoto;
    db.car.addHook('beforeBulkUpdate', hook, async options => {
      if (options.where.id !== car.id || options.attributes.image !== xDrivePhoto) return;
      choseCover = true;
      await db.car.update({ image: chosen, updated_img: true }, {
        where: { id: car.id }, transaction: options.transaction, hooks: false
      });
    });
    try {
      await images.applyVerifiedCatalogPhotos();
      assert.equal(choseCover, true);
      assert.equal((await car.reload()).getDataValue('image'), chosen);
      db.car.removeHook('beforeBulkUpdate', hook);

      await db.car_image.create({ carId: car.id, url: chosen, source: 'catalog' });
      await car.update({ updated_img: false, wiki_checked: false });
      const { Op } = db.Sequelize;
      db.car.findAll = function(options) {
        return originalFindAll.call(this, { ...options, where: { [Op.and]: [options.where, { id: car.id }] } });
      };
      wikimedia.findLeadPhoto = async () => ({ url: thumb('0/00', 'BMW_528i_xDrive_alternate.jpg') });
      assert.equal(await images.wikipediaPhotos(1, { delayMs: 0 }), 1);
      assert.equal((await car.reload()).getDataValue('image'), chosen);
      assert.equal(car.wiki_checked, true);
    } finally {
      db.car.removeHook('beforeBulkUpdate', hook);
      db.car.findAll = originalFindAll;
      wikimedia.findLeadPhoto = originalFindPhoto;
      await car.destroy();
    }
  });
});
