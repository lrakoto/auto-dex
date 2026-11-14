const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');

describe('Public sightings feed', function () {
  const knownUsers = [];
  const knownCars = [];
  const make = 'Activity Fixture';
  const baseTime = Date.UTC(2099, 0, 1);

  async function owner(label, garagePublic, username = 'activity_' + label) {
    const row = await db.user.create({
      email: 'activity-' + label + '@example.test',
      name: 'Activity Private Name ' + label,
      username,
      garagePublic
    }, { hooks: false });
    knownUsers.push(row.id);
    return row;
  }

  async function cars(...models) {
    const rows = await db.car.bulkCreate(models.map(model => ({ make, model })));
    knownCars.push(...rows.map(row => row.id));
    return rows;
  }

  function spot(user, car, timestamp, extra = {}) {
    return db.spotting.create({
      userId: user.id, carId: car.id, createdAt: new Date(baseTime + timestamp), ...extra
    });
  }

  async function feed() {
    const res = await request(app).get('/activity').expect(200);
    const directives = (res.headers['cache-control'] || '').split(/\s*,\s*/i);
    assert.ok(directives.includes('private') && directives.includes('no-store'), res.headers['cache-control']);
    assert.match(res.text, /<h1\b[^>]*>\s*Recent sightings\s*<\/h1>/i);
    return res.text;
  }

  const detail = car => '/cars/car?make=' + encodeURIComponent(car.make) + '&model=' + encodeURIComponent(car.model);
  const modelMarker = car => 'model=' + encodeURIComponent(car.model);

  afterEach(async function () {
    if (knownUsers.length) await db.user.destroy({ where: { id: knownUsers.splice(0) } });
    if (knownCars.length) await db.car.destroy({ where: { id: knownCars.splice(0) } });
  });

  it('shows a useful empty state when there are no public sightings', async function () {
    // Isolate the view's empty state from fixtures left in the shared test DB.
    const findAll = db.spotting.findAll;
    db.spotting.findAll = async () => [];
    try {
      assert.match(await feed(), /id="activity-empty"/);
    } finally {
      db.spotting.findAll = findAll;
    }
  });

  it('shows only opted-in handles and car links, never private metadata or photos', async function () {
    const publicOwner = await owner('visible', true);
    const privateOwner = await owner('hidden', false);
    const unsetOwner = await owner('unset', true, null);
    const blankOwner = await owner('blank', true, null);
    // Simulate legacy data bypassing the normal handle setter.
    await db.sequelize.query('UPDATE users SET username = :username WHERE id = :id', {
      replacements: { id: blankOwner.id, username: '' }
    });
    const [visible, hidden, unset, blank] = await cars('Visible Sighting', 'Private Sighting', 'Unset Handle Sighting', 'Blank Handle Sighting');
    await spot(publicOwner, visible, 0, {
      notes: 'activity-secret-notes',
      location: 'activity-secret-location',
      imageUrl: 'https://images.example.test/activity-private-photo.jpg'
    });
    await spot(privateOwner, hidden, 1);
    await spot(unsetOwner, unset, 2);
    await spot(blankOwner, blank, 3);

    const html = await feed();
    assert.match(html, /id="activity-feed"/);
    assert.ok(html.includes('@activity_visible'));
    assert.ok(html.includes('href="/u/activity_visible"'));
    assert.match(html, /<time datetime="2099-01-01">Jan 1, 2099<\/time>/);
    // EJS escapes the ampersand in an HTML attribute.
    assert.ok(html.includes('href="' + detail(visible).replace('&', '&amp;') + '"'));
    for (const secret of [publicOwner.email, publicOwner.name, privateOwner.email,
      privateOwner.name, privateOwner.username, unsetOwner.email, unsetOwner.name, blankOwner.email,
      blankOwner.name, hidden.model, unset.model, blank.model, 'activity-secret-notes',
      'activity-secret-location', 'activity-private-photo.jpg']) {
      assert.ok(!html.includes(secret), 'activity feed exposed ' + secret);
    }
  });

  it('sorts by time then id, limits results, and drops hidden or deleted sightings on the next GET', async function () {
    const first = await owner('first', true);
    const second = await owner('second', true);
    const models = await cars(...Array.from({ length: 13 }, (_, i) => 'Ordered Sighting ' + String(i).padStart(2, '0')));
    const sightings = [];
    // Insert model 0 last so ordering by id alone would put the oldest first.
    for (const i of [...models.keys()].slice(1).concat(0)) {
      sightings[i] = await spot(i === 12 ? second : first, models[i], Math.min(i, 11));
    }
    // Model 12 has the same timestamp as model 11, but a higher id.
    const initial = await feed();
    const classes = initial.match(/class="[^"]*"/g) || [];
    assert.equal(classes.filter(value => value.slice(7, -1).split(/\s+/).includes('activity-sighting')).length, 12);
    const positions = models.map(model => initial.indexOf(modelMarker(model)));
    assert.equal(positions[0], -1);
    assert.ok(positions.slice(1).every((position, i) => position >= 0 && (i === 0 || position < positions[i])));

    await second.update({ garagePublic: false });
    const hidden = await feed();
    assert.ok(!hidden.includes(modelMarker(models[12])));
    assert.ok(!hidden.includes('@activity_second'));
    assert.ok(hidden.includes(modelMarker(models[0])));

    await sightings[11].destroy();
    const deleted = await feed();
    assert.ok(!deleted.includes(modelMarker(models[11])));
    assert.ok(deleted.includes(modelMarker(models[10])));
  });
});
