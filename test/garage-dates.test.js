const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken, createVerifiedUser } = require('./helpers');

function form(agent, url, body, token) {
  return agent.post(url).set('Content-Type', 'application/x-www-form-urlencoded').send({ ...body, _csrf: token });
}

// Well-formed but impossible dates used to reach Postgres and come back as a
// generic "could not save"; every garage log now says what's wrong
describe('Garage log dates', function() {
  const agent = request.agent(app);
  let car;

  before(async function() {
    const user = await createVerifiedUser(agent, db, { email: 'garage-dates@example.com', name: 'Dee' });
    car = await db.user_car.create({ userId: user.id, make: 'Mazda', model: 'MX-5 Miata', year: '1991' });
  });

  const said = async text => {
    const res = await agent.get(`/garage/car/${car.id}`).expect(200);
    return res.text.includes(text);
  };

  it('rejects an impossible maintenance date with its message', async function() {
    for (const date of ['2026-02-30', '2026-13-01']) {
      const token = await getCsrfToken(agent, '/garage');
      await form(agent, `/garage/car/${car.id}/maintenance`, { date, title: 'Oil change' }, token).expect(302);
      assert.ok(await said('That date doesn&#39;t exist.'), `no message for ${date}`);
    }
    assert.equal(await db.maintenance_log.count({ where: { userCarId: car.id } }), 0);
  });

  it('rejects an impossible build log date with its message', async function() {
    const token = await getCsrfToken(agent, '/garage');
    await form(agent, `/garage/car/${car.id}/build`, { date: '2026-13-01', part: 'Coilovers' }, token).expect(302);
    assert.ok(await said('That date doesn&#39;t exist.'));
    assert.equal(await db.build_entry.count({ where: { userCarId: car.id } }), 0);
  });

  it('still accepts a real date, leap day included', async function() {
    const token = await getCsrfToken(agent, '/garage');
    await form(agent, `/garage/car/${car.id}/maintenance`, { date: '2024-02-29', title: 'Tires' }, token).expect(302);
    await form(agent, `/garage/car/${car.id}/build`, { date: '2024-02-29', part: 'Hardtop' }, token).expect(302);
    assert.equal(await db.maintenance_log.count({ where: { userCarId: car.id } }), 1);
    assert.equal(await db.build_entry.count({ where: { userCarId: car.id } }), 1);
  });
});
