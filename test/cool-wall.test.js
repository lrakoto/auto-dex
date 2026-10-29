const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const coolWall = require('../lib/coolWall');
const { extractCsrf, createVerifiedUser } = require('./helpers');
const { PLACEHOLDER_URL } = require('../lib/constants');

const PAGE = '/cars/car?make=Lotus&model=Elan%20Cool%20Test';

describe('Cool Wall (R10)', function() {
  let real, car;
  const agent = request.agent(app);
  let user;

  before(async function() {
    real = {
      getModels: carquery.getModels,
      getWikiSummary: carinfo.getWikiSummary,
      getFuelSpecs: carinfo.getFuelSpecs,
      getWikidataFacts: carinfo.getWikidataFacts,
      getSafetyRatings: nhtsa.getSafetyRatings
    };
    carquery.getModels = async () => [];
    carinfo.getWikiSummary = async () => null;
    carinfo.getFuelSpecs = async () => null;
    carinfo.getWikidataFacts = async () => [];
    nhtsa.getSafetyRatings = async () => null;
    [car] = await db.car.findOrCreate({
      where: { make: 'Lotus', model: 'Elan Cool Test' },
      defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car' }
    });
    user = await createVerifiedUser(agent, db, { email: 'cool-wall@example.com', name: 'Jeremy' });
  });
  after(function() {
    carquery.getModels = real.getModels;
    Object.assign(carinfo, { getWikiSummary: real.getWikiSummary, getFuelSpecs: real.getFuelSpecs, getWikidataFacts: real.getWikidataFacts });
    nhtsa.getSafetyRatings = real.getSafetyRatings;
  });

  const vote = async (tier, who = agent) => {
    const page = await who.get(PAGE).expect(200);
    const res = await who.post('/cars/cool').type('form')
      .send({ _csrf: extractCsrf(page.text), make: 'Lotus', model: 'Elan Cool Test', tier });
    assert.equal(res.status, 302);
    return res;
  };

  describe('tally', function() {
    it('places a car at the rounded mean of its votes, halves toward cool', function() {
      assert.equal(coolWall.tally([0, 0, 0, 0]).placement, null);
      assert.equal(coolWall.tally([0, 0, 2, 1]).placement, 2); // mean 2.33 → Cool
      assert.equal(coolWall.tally([1, 0, 0, 1]).placement, 2); // mean 1.5 → Cool
      assert.equal(coolWall.tally([3, 1, 0, 0]).placement, 0); // mean 0.25
      assert.equal(coolWall.tally([0, 0, 0, 3]).placement, 3);
      assert.equal(coolWall.tally([2, 0, 1, 0]).total, 3);
    });
  });

  describe('the wall', function() {
    it('starts empty', async function() {
      const res = await request(app).get('/cars/cool-wall').expect(200);
      assert.ok(res.text.includes('The wall is empty'));
    });
  });

  describe('voting', function() {
    it('shows signed-out visitors the tally and a log-in prompt, no form', async function() {
      const res = await request(app).get(PAGE).expect(200);
      assert.ok(res.text.includes('id="cool-wall"'));
      assert.ok(res.text.includes('Nobody has put the Elan Cool Test on the wall yet.'));
      assert.ok(!res.text.includes('action="/cars/cool"'));
      assert.ok(res.text.includes('to put it on the wall'));
    });

    it('refuses signed-out posts', async function() {
      const anon = request.agent(app);
      await anon.get('/auth/login').expect(200); // a session for the CSRF token
      const page = await anon.get('/auth/login');
      await anon.post('/cars/cool').type('form')
        .send({ _csrf: extractCsrf(page.text), make: 'Lotus', model: 'Elan Cool Test', tier: 'cool' })
        .expect(302).expect('Location', /\/auth\/login/);
      assert.equal(await db.cool_vote.count({ where: { carId: car.id } }), 0);
    });

    it('records a vote, changes it, and takes it back on a second tap', async function() {
      const res = await vote('sub-zero');
      assert.equal(res.headers.location, '/cars/car?make=Lotus&model=Elan%20Cool%20Test#cool-wall');
      let row = await db.cool_vote.findOne({ where: { carId: car.id, userId: user.id } });
      assert.equal(row.tier, 3);

      await vote('uncool');
      row = await db.cool_vote.findOne({ where: { carId: car.id, userId: user.id } });
      assert.equal(row.tier, 1);
      assert.equal(await db.cool_vote.count({ where: { carId: car.id } }), 1, 'one vote per user per car');

      await vote('uncool');
      assert.equal(await db.cool_vote.count({ where: { carId: car.id } }), 0, 'same tier again clears');
    });

    it('ignores an unknown tier', async function() {
      await vote('lukewarm');
      assert.equal(await db.cool_vote.count({ where: { carId: car.id } }), 0);
    });

    it('shows the placement, the split and the viewer\'s own vote', async function() {
      await vote('cool');
      const other = request.agent(app);
      await createVerifiedUser(other, db, { email: 'cool-wall-2@example.com', name: 'Richard' });
      await vote('sub-zero', other);

      const res = await agent.get(PAGE).expect(200);
      assert.match(res.text, /Members say <strong class="cool-tier-name cool-tier-3">Sub-Zero<\/strong>\s*<span class="cool-count">· 2 votes/);
      assert.match(res.text, /value="cool" class="cool-vote-btn cool-tier-2 is-mine" aria-pressed="true"/);
      assert.ok(res.text.includes('Seriously Uncool: 0, Uncool: 0, Cool: 1, Sub-Zero: 1'));
    });
  });

  describe('the wall, with votes', function() {
    it('lists the car under its placement with its vote count', async function() {
      const res = await request(app).get('/cars/cool-wall').expect(200);
      const subZero = res.text.split('id="cool-col-sub-zero"')[1].split('</section>')[0];
      assert.ok(subZero.includes('Lotus Elan Cool Test'));
      assert.ok(subZero.includes('2 votes'));
      const cool = res.text.split('id="cool-col-cool"')[1].split('</section>')[0];
      assert.ok(!cool.includes('Elan Cool Test'));
    });

    it('caps each tier and places halves like the car page does', async function() {
      // Four more cars, each with one Sub-Zero vote and one Cool vote: mean 2.5
      const voters = await Promise.all([1, 2].map(i => db.user.create({ name: `Wall ${i}`, email: `cool-wall-cap-${i}@example.com`, password: 'password123', emailVerified: true })));
      for (const n of [1, 2, 3, 4]) {
        const [extra] = await db.car.findOrCreate({
          where: { make: 'Lotus', model: `Cap Test ${n}` },
          defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car' }
        });
        await coolWall.castVote(extra.id, voters[0].id, 3);
        await coolWall.castVote(extra.id, voters[1].id, 2);
        const tally = await coolWall.getCarCool(extra.id, null);
        assert.equal(tally.placement, 3, 'car page rounds 2.5 to Sub-Zero');
      }
      const wall = await coolWall.getWall(3);
      assert.equal(wall[3].cars.length, 3, 'capped at three per tier');
      assert.ok(wall[3].cars.every(c => c.total === 2), 'two-vote cars, all placed in Sub-Zero');
      assert.equal(wall[2].cars.filter(c => c.model.startsWith('Cap Test')).length, 0, 'none placed in Cool');
      for (const v of voters) await v.destroy();
    });

    it('drops a user\'s votes with the user', async function() {
      const temp = await db.user.create({ name: 'Temp', email: 'cool-temp@example.com', password: 'password123', emailVerified: true });
      await coolWall.castVote(car.id, temp.id, 0);
      await temp.destroy();
      assert.equal(await db.cool_vote.count({ where: { userId: temp.id } }), 0);
    });
  });
});
