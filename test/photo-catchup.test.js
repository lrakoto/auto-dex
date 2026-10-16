const assert = require('node:assert/strict');
const db = require('../models');
const images = require('../jobs/images');
const wikimedia = require('../lib/wikimedia');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('Bounded photo retirement catch-up', function() {
  let realFind;
  let realLog;
  const lookedUp = [];
  const logs = [];
  const ids = [];
  const retired = 'https://images.unsplash.com/photo-catchup';
  const beforeRetirement = new Date(images.UNSPLASH_RETIREMENT_AT.getTime() - 1);

  async function cars(count, values = {}) {
    const rows = await db.car.bulkCreate(Array.from({ length: count }, (_, index) => ({
      make: 'Lancia', model: `Photo catch-up ${ids.length + index}`,
      image: PLACEHOLDER_URL, wiki_checked: false, wiki_checked_at: null,
      ...values
    })));
    ids.push(...rows.map(row => row.id));
    return rows;
  }

  before(function() {
    realFind = wikimedia.findLeadPhoto;
    realLog = console.log;
  });
  beforeEach(async function() {
    // The shared test catalog should not become eligible for this queue test.
    await db.car.update({ wiki_checked: true, wiki_checked_at: new Date() }, { where: {} });
    lookedUp.length = 0;
    logs.length = 0;
    wikimedia.findLeadPhoto = async (make, model) => { lookedUp.push(model); return null; };
    console.log = (...parts) => { logs.push(parts.join(' ')); };
  });
  afterEach(async function() {
    wikimedia.findLeadPhoto = realFind;
    console.log = realLog;
    if (ids.length) await db.car.destroy({ where: { id: ids.splice(0) } });
  });

  it('attempts at most 500 old retired covers, then advances past checked misses', async function() {
    const rows = await cars(501, { image: retired, updated_img: true,
      wiki_checked: true, wiki_checked_at: beforeRetirement });
    await images.updatePhotos({ delayMs: 0 });
    assert.equal(lookedUp.length, 500);
    assert.ok(logs.includes('Wikipedia photos: 0 found for 500 cars attempted (500 selected)'));
    const untouched = await db.car.findAll({ where: { id: rows.map(row => row.id), wiki_checked_at: beforeRetirement } });
    assert.equal(untouched.length, 1);
    await images.updatePhotos({ delayMs: 0 });
    assert.equal(lookedUp.length, 501, 'a checked miss does not monopolize the next batch');
    assert.equal(new Set(lookedUp).size, 501);
    assert.equal((await rows[0].reload()).getDataValue('image'), retired, 'raw history is preserved');
  });

  it('keeps normal maintenance at 150 once retired covers have reached the rollout boundary', async function() {
    const [checked] = await cars(1, { image: retired, updated_img: true,
      wiki_checked: true, wiki_checked_at: images.UNSPLASH_RETIREMENT_AT });
    await cars(151);
    await images.updatePhotos({ delayMs: 0 });
    assert.equal(lookedUp.length, 150);
    assert.ok(!lookedUp.includes(checked.model), 'the exact boundary is already checked');
    assert.ok(logs.includes('Wikipedia photos: 0 found for 150 cars attempted (150 selected)'));
  });

  it('retains explicit caller budgets during the retirement backlog', async function() {
    await cars(5, { image: retired, updated_img: true,
      wiki_checked: true, wiki_checked_at: null });
    assert.equal(await images.wikipediaPhotos(2, { delayMs: 0 }), 2);
    assert.equal(lookedUp.length, 2);
  });

  it('stops after three consecutive provider failures and reports attempts accurately', async function() {
    const rows = await cars(10, { image: retired, updated_img: true,
      wiki_checked: true, wiki_checked_at: beforeRetirement });
    wikimedia.findLeadPhoto = async (make, model) => {
      lookedUp.push(model);
      throw new Error('Commons temporarily unavailable');
    };
    await images.updatePhotos({ delayMs: 0 });
    assert.equal(lookedUp.length, 3);
    assert.ok(logs.includes('Wikipedia photos: 0 found for 3 cars attempted (10 selected)'));
    assert.equal(await db.car.count({ where: { id: rows.map(row => row.id), wiki_checked_at: beforeRetirement } }), 10,
      'failed attempts retain their retry eligibility');
  });
});
