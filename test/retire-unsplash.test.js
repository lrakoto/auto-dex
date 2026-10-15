const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { isRetiredPhoto, displayPhoto } = require('../lib/photoPolicy');
const { photoCredit, cardPhoto, sizedPhoto, favoritePhoto, photoBackground } = require('../lib/photos');
const { isValidImageUrl } = require('../lib/validators');
const { photoPoolWhere } = require('../lib/catalog');
const gallery = require('../lib/gallery');
const wikimedia = require('../lib/wikimedia');
const unsplash = require('../lib/unsplash');
const images = require('../jobs/images');
const quiz = require('../lib/quiz');
const { extractCsrf } = require('./helpers');

const retired = 'https://images.unsplash.com/photo-retired?w=1080';
const replacement = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Retirement_car.jpg';
const retiredUrls = [retired, 'https://UNSPLASH.COM/car', 'http://source.unsplash.com/car',
  'https://images.unsplash.com.:443/car', 'https://user@images.unsplash.com/car', '//images.unsplash.com/legacy-car'];
const otherUrls = ['https://example.com/unsplash.com/car.jpg', 'https://unsplash.com.example.org/car.jpg',
  'https://unsplash.com@example.org/car.jpg', 'https://my-unsplash.com/car.jpg', replacement];

describe('Retiring inaccurate Unsplash photos', function() {
  it('matches only the retired hostname family and rejects new submissions from it', function() {
    for (const url of retiredUrls) {
      assert.equal(isRetiredPhoto(url), true, url);
      assert.equal(isValidImageUrl(url), false, url);
      assert.equal(displayPhoto(url), PLACEHOLDER_URL, url);
    }
    for (const url of otherUrls) {
      assert.equal(isRetiredPhoto(url), false, url);
      assert.equal(displayPhoto(url), url);
    }
    for (const url of [null, undefined, '', 'not a URL']) assert.equal(isRetiredPhoto(url), false);
  });

  it('suppresses retired card, hero, favorite and credit URLs while retaining a current catalog fallback', function() {
    assert.equal(cardPhoto(retired), PLACEHOLDER_URL);
    assert.equal(sizedPhoto(retired, 1280), PLACEHOLDER_URL);
    assert.equal(photoBackground(retired), `url(${JSON.stringify(PLACEHOLDER_URL)})`);
    assert.equal(favoritePhoto({ image: retired, car: { image: replacement } }), replacement);
    assert.equal(favoritePhoto({ image: retired, car: { image: retired } }), PLACEHOLDER_URL);
    assert.equal(photoCredit(retired, { source: 'unsplash', credit_name: 'Old author' }), null);
    assert.equal(photoCredit('https://example.com/old.jpg', { source: 'unsplash', credit_name: 'Old author' }), null);
  });

  it('retains licensing for other providers without revealing a source filename in the quiz', function() {
    const row = { source: 'openverse', credit_name: 'Photographer', credit_url: 'https://example.com/Toyota_Camry.jpg',
      license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/' };
    assert.deepEqual(photoCredit(replacement, row), {
      name: 'Photographer', url: row.credit_url, license: row.license, licenseUrl: row.license_url, source: 'openverse', commons: false
    });
    const quizCredit = photoCredit(replacement, row, { linkSource: false });
    assert.equal(quizCredit.url, null);
    assert.equal(quizCredit.license, row.license);
  });

  it('makes direct model reads and JSON safe while preserving the original database fields', function() {
    for (const model of ['car', 'user_car', 'favorite_car']) {
      const row = db[model].build({ image: retired });
      assert.equal(row.image, PLACEHOLDER_URL, model);
      assert.equal(row.toJSON().image, PLACEHOLDER_URL, model);
      assert.equal(row.getDataValue('image'), retired, model);
    }
    const proposal = db.image_proposal.build({ imageUrl: retired });
    assert.equal(proposal.imageUrl, PLACEHOLDER_URL);
    assert.equal(proposal.getDataValue('imageUrl'), retired);
    const spotting = db.spotting.build({ imageUrl: retired });
    assert.equal(spotting.imageUrl, null);
    assert.equal(spotting.getDataValue('imageUrl'), retired);
    assert.equal(db.spotting.build({ imageUrl: null }).imageUrl, null);
    assert.equal(db.favorite_car.build({ image: null }).image, null, 'null retains the catalog-inheritance meaning');
    assert.equal(db.favorite_car.build({ image: '' }).image, '', 'empty retains the catalog-inheritance meaning');
  });

  it('excludes retired hosts from the quiz and daily photo pool in SQL, preserving similarly named hosts', async function() {
    const urls = [...retiredUrls, ...otherUrls];
    const rows = await db.car.bulkCreate(urls.map((image, index) => ({
      make: 'Lancia', model: `Retirement pool ${index}`, image, updated_img: true, vehicle_type: 'car'
    })));
    const found = await db.car.findAll({ where: photoPoolWhere({ id: rows.map(row => row.id) }) });
    assert.deepEqual(found.map(row => row.getDataValue('image')).sort(), otherUrls.slice().sort());
  });

  it('hides retired gallery history, refuses its votes, and cannot promote it back to the hero', async function() {
    const car = await db.car.create({ make: 'Lancia', model: 'Retirement gallery', image: retired, updated_img: true });
    const old = await db.car_image.create({ carId: car.id, url: retired, source: 'catalog', score: 100 });
    const oldSource = await db.car_image.create({ carId: car.id, url: 'https://example.com/retired-source.jpg', source: 'unsplash', score: 200 });
    const safe = await db.car_image.create({ carId: car.id, url: replacement, source: 'wikimedia', score: 0 });
    const shown = await gallery.getGallery(car.id, null, retired);
    assert.deepEqual(shown.map(row => row.id), [safe.id]);
    assert.equal(await gallery.vote(old.id, 987654, 1), null);
    assert.equal(await gallery.vote(oldSource.id, 987654, 1), null);
    assert.equal(await db.car_image_vote.count({ where: { imageId: [old.id, oldSource.id] } }), 0);
    assert.equal((await gallery.refreshHero(car.id)).id, safe.id);
    await car.reload();
    assert.equal(car.image, replacement);
    assert.equal(await db.car_image.count({ where: { carId: car.id } }), 3);
    assert.equal((await old.reload()).score, 100);
  });

  it('does not add retired gallery URLs or sources even through internal callers', async function() {
    const car = await db.car.create({ make: 'Lancia', model: 'Retirement rejection', image: PLACEHOLDER_URL });
    assert.equal(await gallery.addImage(car.id, retired, { source: 'user', makeHero: true }), null);
    assert.equal(await gallery.addImage(car.id, replacement, { source: 'unsplash', makeHero: true }), null);
    assert.equal(await db.car_image.count({ where: { carId: car.id } }), 0);
    assert.equal((await car.reload()).image, PLACEHOLDER_URL);
  });

  it('replaces a persisted quiz answer after photo retirement without resetting the earned streak', async function() {
    const rows = await db.car.bulkCreate([1, 2, 3, 4].map(index => ({
      make: 'Lancia', model: `Retirement session ${index}`,
      image: `https://example.com/retirement-session-${index}.jpg`, updated_img: true
    })));
    const choices = rows.map(row => row.id);
    const realNewRound = quiz.newRound;
    const streaks = [];
    quiz.newRound = async state => {
      streaks.push(state.streak);
      return { answer: rows[streaks.length < 3 ? 0 : 1].id, choices };
    };
    try {
      const player = request.agent(app);
      const first = await player.get('/play').expect(200);
      const token = extractCsrf(first.text);
      const result = await player.post('/play/guess').type('form').set('X-Requested-With', 'XMLHttpRequest')
        .send({ choice: rows[0].id, _csrf: token }).expect(200);
      assert.equal(result.body.streak, 1);
      await rows[0].update({ image: retired });
      assert.equal(await quiz.roundView({ answer: rows[0].id, choices }), null);
      const refreshed = await player.get('/play').expect(200);
      assert.deepEqual(streaks, [0, 1, 1]);
      assert.ok(refreshed.text.includes(rows[1].image));
      assert.ok(!refreshed.text.includes(retired));
      assert.equal(rows[0].getDataValue('image'), retired);
    } finally {
      quiz.newRound = realNewRound;
    }
  });

  describe('bounded Commons replacement queue', function() {
    let realFind;
    const lookedUp = [];
    before(function() { realFind = wikimedia.findLeadPhoto; });
    after(function() { wikimedia.findLeadPhoto = realFind; });
    beforeEach(async function() {
      await db.car.update({ wiki_checked: true, wiki_checked_at: new Date() }, { where: {} });
      lookedUp.length = 0;
      wikimedia.findLeadPhoto = async (make, model) => { lookedUp.push(model); return null; };
    });
    const beforeRollout = () => new Date(images.UNSPLASH_RETIREMENT_AT.getTime() - 1000);

    it('prioritizes every retired hero once even after a recent successful lookup, then lets new cars proceed', async function() {
      const old = await db.car.create({ make: 'Lancia', model: 'Retirement priority', image: retired, updated_img: true,
        wiki_checked: true, wiki_checked_at: beforeRollout(), favcount: 0 });
      await db.car_image.create({ carId: old.id, url: replacement, source: 'wikimedia' });
      await db.car.create({ make: 'Lancia', model: 'Retirement new car', image: PLACEHOLDER_URL,
        wiki_checked: false, favcount: 9999 });
      await images.wikipediaPhotos(1, { delayMs: 0 });
      assert.deepEqual(lookedUp, ['Retirement priority']);
      await old.reload();
      assert.equal(old.getDataValue('image'), retired, 'miss preserves the original record');
      assert.equal(old.image, PLACEHOLDER_URL, 'miss is hidden immediately');
      assert.ok(old.wiki_checked_at > images.UNSPLASH_RETIREMENT_AT);
      await images.wikipediaPhotos(1, { delayMs: 0 });
      assert.deepEqual(lookedUp, ['Retirement priority', 'Retirement new car']);
    });

    it('replaces voted stock imagery with a credited Commons image and preserves the old gallery record', async function() {
      const car = await db.car.create({ make: 'Lancia', model: 'Retirement voted', image: retired, updated_img: true,
        wiki_checked: true, wiki_checked_at: beforeRollout() });
      const old = await db.car_image.create({ carId: car.id, url: retired, source: 'unsplash', score: 50 });
      wikimedia.findLeadPhoto = async () => ({ url: replacement, creditName: 'Photographer',
        creditUrl: 'https://commons.wikimedia.org/wiki/File:Retirement_car.jpg', license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' });
      await images.wikipediaPhotos(1, { delayMs: 0 });
      await car.reload();
      assert.equal(car.getDataValue('image'), replacement);
      const current = await db.car_image.findOne({ where: { carId: car.id, url: replacement } });
      assert.equal(current.credit_name, 'Photographer');
      assert.equal(current.license, 'CC BY 4.0');
      assert.equal((await old.reload()).score, 50);
    });

    it('also queues retired photos on catalog makes outside the current manufacturer list', async function() {
      const car = await db.car.create({ make: 'Retirement Custom Builder', model: 'Retirement custom car',
        image: '//source.unsplash.com/retirement-custom', updated_img: true,
        wiki_checked: true, wiki_checked_at: beforeRollout() });
      await images.wikipediaPhotos(1, { delayMs: 0 });
      assert.deepEqual(lookedUp, ['Retirement custom car']);
      await car.reload();
      assert.ok(car.wiki_checked_at > images.UNSPLASH_RETIREMENT_AT);
      assert.equal(car.image, PLACEHOLDER_URL);
      assert.equal(car.getDataValue('image'), '//source.unsplash.com/retirement-custom');
    });

    it('retries an unsuccessful replacement only after the normal cooldown', async function() {
      const old = await db.car.create({ make: 'Lancia', model: 'Retirement month retry', image: retired, updated_img: true,
        wiki_checked: true, wiki_checked_at: new Date() });
      await images.wikipediaPhotos(10, { delayMs: 0 });
      assert.deepEqual(lookedUp, []);
      await old.update({ wiki_checked_at: new Date(Date.now() - (images.WIKI_RECHECK_DAYS + 1) * 86400000) });
      await images.wikipediaPhotos(10, { delayMs: 0 });
      assert.deepEqual(lookedUp, ['Retirement month retry']);
    });

    it('makes no Unsplash requests from either the hourly entrypoint or compatibility functions', async function() {
      const realSearch = unsplash.searchCarPhoto;
      const realTrack = unsplash.trackDownload;
      let calls = 0;
      unsplash.searchCarPhoto = async () => { calls++; throw new Error('retired API'); };
      unsplash.trackDownload = async () => { calls++; throw new Error('retired API'); };
      try {
        await images.updatePhotos();
        assert.equal(await images.unsplashImages(), 0);
        assert.equal(await images.backfillCredits(45), 0);
        assert.equal(calls, 0);
      } finally {
        unsplash.searchCarPhoto = realSearch;
        unsplash.trackDownload = realTrack;
      }
    });
  });
});
