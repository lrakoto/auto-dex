const request = require('supertest');
const axios = require('axios');
const app = require('../server');
const db = require('../models');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { fuelStats } = require('../lib/fuel');
const { cacheClear } = require('../lib/cache');

function form(agent, method, url, body, token) {
  return agent[method](url)
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .set('Referrer', '/')
    .send({ ...body, _csrf: token });
}

describe('Fuel log', function() {
  describe('lib/fuel.fuelStats', function() {
    it('computes full-to-full MPG, cost/mile and totals, ignoring order', function() {
      const logs = [
        { odometer: 10500, gallons: 11, cost: 38.5 },
        { odometer: 10000, gallons: 10, cost: 35 },
        { odometer: 11000, gallons: 12, cost: 40 }
      ];
      const stats = fuelStats(logs);
      if (stats.fillUps !== 3) throw new Error('fillUps wrong');
      if (stats.milesDriven !== 1000) throw new Error('milesDriven wrong: ' + stats.milesDriven);
      // Miles driven since the first fill (1000) over the gallons at the later fills (11 + 12 = 23)
      if (Math.abs(stats.avgMpg - 1000 / 23) > 1e-9) throw new Error('avgMpg wrong: ' + stats.avgMpg);
      if (stats.totalCost !== 113.5) throw new Error('totalCost wrong: ' + stats.totalCost);
      if (Math.abs(stats.costPerMile - 113.5 / 1000) > 1e-9) throw new Error('costPerMile wrong: ' + stats.costPerMile);
    });

    it('returns nulls instead of dividing by zero with fewer than two fill-ups', function() {
      const stats = fuelStats([{ odometer: 10000, gallons: 10, cost: 35 }]);
      if (stats.milesDriven !== 0) throw new Error('milesDriven should be 0 with one entry');
      if (stats.avgMpg !== null) throw new Error('avgMpg should be null with one entry');
      if (stats.costPerMile !== null) throw new Error('costPerMile should be null with no miles');
    });

    it('withholds cost/mile (but not MPG) when any fill-up has no cost', function() {
      const logs = [
        { odometer: 10000, gallons: 10, cost: null },
        { odometer: 10300, gallons: 10, cost: 30 }
      ];
      const stats = fuelStats(logs);
      if (stats.avgMpg !== 30) throw new Error('avgMpg should still compute: ' + stats.avgMpg);
      if (stats.costPerMile !== null) throw new Error('costPerMile should be null with a missing price');
      if (stats.totalCost !== 30) throw new Error('totalCost should only sum priced fill-ups');
    });
  });

  describe('Garage car fuel log routes', function() {
    const alice = request.agent(app);
    const bob = request.agent(app);
    let aliceUser, myCar;

    before(async function() {
      aliceUser = await createVerifiedUser(alice, db, { email: 'alice-fuel@example.com', name: 'Alice' });
      await createVerifiedUser(bob, db, { email: 'bob-fuel@example.com', name: 'Bob' });
      const token = await getCsrfToken(alice, '/garage/add');
      await form(alice, 'post', '/garage/add', { make: 'Toyota', model: 'Prius', year: '2015' }, token).expect(302);
      myCar = await db.user_car.findOne({ where: { userId: aliceUser.id, make: 'Toyota', model: 'Prius' } });
    });

    beforeEach(function() { cacheClear(); axios.get = async () => { throw new Error('no FuelEconomy.gov in sandbox'); }; });

    it('adds and deletes fuel log entries, owner only', async function() {
      let token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/garage/car/${myCar.id}/fuel`, {
        date: '2026-09-01', odometer: '42,000', gallons: '10.5', cost: '$38.25'
      }, token).expect(302);
      const log = await db.fuel_log.findOne({ where: { userCarId: myCar.id } });
      if (!log || log.odometer !== 42000 || Number(log.gallons) !== 10.5 || parseFloat(log.cost) !== 38.25) {
        throw new Error('entry not parsed/saved');
      }

      // Bob can't add to or delete from Alice's car
      const bobToken = await getCsrfToken(bob, '/garage');
      await form(bob, 'post', `/garage/car/${myCar.id}/fuel`, { date: '2026-09-02', odometer: '1', gallons: '1' }, bobToken).expect(302);
      await form(bob, 'post', `/garage/car/${myCar.id}/fuel/${log.id}?_method=DELETE`, {}, bobToken).expect(302);
      if (await db.fuel_log.count({ where: { userCarId: myCar.id } }) !== 1) throw new Error('IDOR on fuel log');

      token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/garage/car/${myCar.id}/fuel`, { date: 'yesterday', odometer: '43000', gallons: '10' }, token).expect(302);
      if (await db.fuel_log.count({ where: { userCarId: myCar.id } }) !== 1) throw new Error('invalid date accepted');

      await form(alice, 'post', `/garage/car/${myCar.id}/fuel`, { date: '2026-09-03', odometer: '43000', gallons: '0' }, token).expect(302);
      if (await db.fuel_log.count({ where: { userCarId: myCar.id } }) !== 1) throw new Error('zero gallons accepted');

      await form(alice, 'post', `/garage/car/${myCar.id}/fuel/${log.id}?_method=DELETE`, {}, token).expect(302);
      if (await db.fuel_log.count({ where: { userCarId: myCar.id } }) !== 0) throw new Error('owner could not delete');
    });

    it('shows fuel log stats on the garage car page', async function() {
      const token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/garage/car/${myCar.id}/fuel`, { date: '2026-09-01', odometer: '10000', gallons: '10', cost: '35' }, token).expect(302);
      await form(alice, 'post', `/garage/car/${myCar.id}/fuel`, { date: '2026-09-10', odometer: '10300', gallons: '10', cost: '34' }, token).expect(302);

      const res = await alice.get(`/garage/car/${myCar.id}`).expect(200);
      if (!res.text.includes('Fuel Log')) throw new Error('fuel log section missing');
      if (!res.text.includes('30.0 mpg avg')) throw new Error('avg mpg not shown: expected 300mi/10gal = 30.0');

      await db.fuel_log.destroy({ where: { userCarId: myCar.id } });
    });

    it('degrades gracefully when FuelEconomy.gov is unreachable', async function() {
      const res = await alice.get(`/garage/car/${myCar.id}`).expect(200);
      if (!res.text.includes('Fuel Log')) throw new Error('page should still render without EPA data');
    });
  });
});
