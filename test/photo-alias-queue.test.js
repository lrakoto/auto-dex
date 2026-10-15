const assert = require('node:assert/strict');
const db = require('../models');
const wikimedia = require('../lib/wikimedia');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { wikipediaPhotos, PHOTO_ALIAS_RECHECK_AT } = require('../jobs/images');

describe('Exact photo alias catch-up queue', function() {
  const { Op } = db.Sequelize;
  const rows = {};
  const calls = [];
  const oldCheck = new Date(PHOTO_ALIAS_RECHECK_AT.getTime() - 60000);
  const retired = 'https://images.unsplash.com/photo-alias-queue';
  let realFindAll, realFindPhoto;
  const photo = {
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Alias_queue.jpg/1280px-Alias_queue.jpg',
    creditName: 'Photographer', creditUrl: 'https://commons.wikimedia.org/wiki/File:Alias_queue.jpg',
    license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
  };

  before(async function() {
    realFindAll = db.car.findAll;
    realFindPhoto = wikimedia.findLeadPhoto;
    const fixtures = {
      gr86: ['Toyota', 'GR86', PLACEHOLDER_URL],
      mg3: ['MG', 'MG3', retired],
      mg4: ['MG', 'MG4', 'https://example.com/approved-mg4.jpg'],
      otherMake: ['Lancia', 'GR86', PLACEHOLDER_URL],
      variant: ['Toyota', 'GR86 Queue Special', PLACEHOLDER_URL],
      ordinary: ['Lancia', 'Alias Queue Ordinary', PLACEHOLDER_URL]
    };
    for (const [key, [make, model, image]] of Object.entries(fixtures)) {
      rows[key] = await db.car.create({ make, model, image, updated_img: true, wiki_checked: true, wiki_checked_at: oldCheck, favcount: 0 });
    }
    const ids = Object.values(rows).map(row => row.id);
    // Exercise the actual PostgreSQL predicates/order, isolated from other suites.
    db.car.findAll = function(options) {
      return realFindAll.call(this, { ...options, where: { [Op.and]: [options.where, { id: ids }] } });
    };
  });

  beforeEach(async function() {
    calls.length = 0;
    await db.car.update({ wiki_checked: true, wiki_checked_at: new Date() }, { where: { id: Object.values(rows).map(row => row.id) } });
    wikimedia.findLeadPhoto = async (make, model) => { calls.push(`${make}|${model}`); return photo; };
  });

  after(async function() {
    db.car.findAll = realFindAll;
    wikimedia.findLeadPhoto = realFindPhoto;
    await db.car.destroy({ where: { id: Object.values(rows).map(row => row.id) } });
  });

  it('prioritizes only the precise missing aliases and keeps chosen covers', async function() {
    await db.car.update({ wiki_checked_at: oldCheck }, { where: { id: Object.values(rows).map(row => row.id) } });
    await rows.ordinary.update({ wiki_checked: false });
    await wikipediaPhotos(2, { delayMs: 0 });
    assert.deepEqual(new Set(calls), new Set(['Toyota|GR86', 'MG|MG3']));
    for (const key of ['gr86', 'mg3']) {
      await rows[key].reload();
      assert.equal(rows[key].image, photo.url);
      assert.ok(rows[key].wiki_checked_at > PHOTO_ALIAS_RECHECK_AT);
    }
    await rows.mg4.reload();
    assert.equal(rows.mg4.image, 'https://example.com/approved-mg4.jpg');
    assert.equal((await rows.ordinary.reload()).wiki_checked, false);
  });

  it('stamps a miss once and does not requeue it every hourly run', async function() {
    await rows.gr86.update({ image: PLACEHOLDER_URL, wiki_checked_at: oldCheck });
    wikimedia.findLeadPhoto = async (make, model) => { calls.push(`${make}|${model}`); return null; };
    await wikipediaPhotos(10, { delayMs: 0 });
    await wikipediaPhotos(10, { delayMs: 0 });
    assert.deepEqual(calls, ['Toyota|GR86']);
    await rows.gr86.reload();
    assert.equal(rows.gr86.image, PLACEHOLDER_URL);
    assert.ok(rows.gr86.wiki_checked_at > PHOTO_ALIAS_RECHECK_AT);
  });

  it('retries an interrupted alias lookup without stamping it complete', async function() {
    await rows.mg4.update({ image: null, wiki_checked_at: null });
    wikimedia.findLeadPhoto = async () => { throw new Error('Temporary Commons failure'); };
    await wikipediaPhotos(10, { delayMs: 0 });
    await rows.mg4.reload();
    assert.equal(rows.mg4.wiki_checked_at, null);
    wikimedia.findLeadPhoto = async (make, model) => { calls.push(`${make}|${model}`); return photo; };
    await wikipediaPhotos(10, { delayMs: 0 });
    assert.deepEqual(calls, ['MG|MG4']);
    assert.equal((await rows.mg4.reload()).image, photo.url);
  });
});
