const assert = require('node:assert/strict');
const request = require('supertest');
const axios = require('axios');
const app = require('../server');
const db = require('../models');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { cacheClear } = require('../lib/cache');

function form(agent, method, url, body, token) {
  return agent[method](url)
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .set('Referrer', '/')
    .send({ ...body, _csrf: token });
}

describe('Build log (R13)', function() {
  const alice = request.agent(app);
  const bob = request.agent(app);
  let aliceUser, myCar, realGet;

  before(async function() {
    realGet = axios.get;
    aliceUser = await createVerifiedUser(alice, db, { email: 'alice-build@example.com', name: 'Alice' });
    await createVerifiedUser(bob, db, { email: 'bob-build@example.com', name: 'Bob' });
    const token = await getCsrfToken(alice, '/garage/add');
    await form(alice, 'post', '/garage/add', { make: 'Mazda', model: 'MX-5 Miata', year: '1991' }, token).expect(302);
    myCar = await db.user_car.findOne({ where: { userId: aliceUser.id, make: 'Mazda' } });
  });
  // No recalls or FuelEconomy.gov from the sandbox: the page copes without them
  beforeEach(function() { cacheClear(); axios.get = async () => { throw new Error('offline'); }; });
  after(function() { axios.get = realGet; });

  const add = async (body, agent = alice) => {
    const token = await getCsrfToken(agent, '/garage');
    return form(agent, 'post', `/garage/car/${myCar.id}/build`, body, token).expect(302);
  };
  const count = () => db.build_entry.count({ where: { userCarId: myCar.id } });

  it('adds an entry with vendor, cost, notes and a photo URL', async function() {
    await add({ date: '2026-03-14', part: 'Coilovers', vendor: 'Flyin Miata', cost: '$1,250.00', notes: 'Ride height -1in', imageUrl: 'https://example.com/coilovers.jpg' });
    const entry = await db.build_entry.findOne({ where: { userCarId: myCar.id, part: 'Coilovers' } });
    assert.equal(entry.vendor, 'Flyin Miata');
    assert.equal(parseFloat(entry.cost), 1250);
    assert.equal(entry.notes, 'Ride height -1in');
    assert.equal(entry.imageUrl, 'https://example.com/coilovers.jpg');
  });

  it('rejects a missing part, a bad date, a negative cost and a non-http photo', async function() {
    const before = await count();
    await add({ date: '2026-03-15', part: '   ' });
    await add({ date: 'last week', part: 'Exhaust' });
    await add({ date: '2026-03-15', part: 'Exhaust', cost: '-5' });
    await add({ date: '2026-03-15', part: 'Exhaust', imageUrl: 'javascript:alert(1)' });
    assert.equal(await count(), before);
  });

  it('keeps other users out of your build log', async function() {
    const entry = await db.build_entry.findOne({ where: { userCarId: myCar.id } });
    const before = await count();
    await add({ date: '2026-03-16', part: 'Sneaky part' }, bob);
    const token = await getCsrfToken(bob, '/garage');
    await form(bob, 'post', `/garage/car/${myCar.id}/build/${entry.id}?_method=DELETE`, {}, token).expect(302);
    assert.equal(await count(), before);
  });

  it('shows the timeline and the total on the garage car page, newest first', async function() {
    await add({ date: '2026-05-01', part: 'Hardtop', cost: '750' });
    const res = await alice.get(`/garage/car/${myCar.id}`).expect(200);
    assert.ok(res.text.includes('Build Log'));
    assert.ok(res.text.includes('2 mods · $2,000.00 spent'));
    assert.ok(res.text.indexOf('Hardtop') < res.text.indexOf('Coilovers'), 'newest first');
    assert.ok(res.text.includes('Ride height -1in'), 'the owner sees their notes');
    assert.ok(res.text.includes(`action="/garage/car/${myCar.id}/build?_csrf=`), 'multipart form carries _csrf in its URL');
  });

  it('shows part, vendor and photo on the public garage, never cost or notes', async function() {
    await db.user.update({ username: 'miata_alice', garagePublic: true }, { where: { id: aliceUser.id } });
    const res = await request(app).get('/u/miata_alice').expect(200);
    assert.ok(res.text.includes('Build Logs'));
    assert.ok(res.text.includes('1991 Mazda MX-5 Miata'));
    assert.ok(res.text.includes('Coilovers') && res.text.includes('Flyin Miata'));
    assert.ok(res.text.includes('src="https://example.com/coilovers.jpg"'));
    assert.ok(!res.text.includes('Ride height'), 'notes stay private');
    assert.ok(!res.text.includes('1,250') && !res.text.includes('$750'), 'costs stay private');
  });

  it('lets the owner delete an entry, and entries go with their car', async function() {
    const entry = await db.build_entry.findOne({ where: { userCarId: myCar.id, part: 'Hardtop' } });
    const token = await getCsrfToken(alice, '/garage');
    await form(alice, 'post', `/garage/car/${myCar.id}/build/${entry.id}?_method=DELETE`, {}, token).expect(302);
    assert.equal(await db.build_entry.count({ where: { id: entry.id } }), 0);

    await myCar.destroy();
    assert.equal(await db.build_entry.count({ where: { userCarId: myCar.id } }), 0);
  });
});
