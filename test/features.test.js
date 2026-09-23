const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { PLACEHOLDER_URL } = require('../lib/constants');

function form(agent, method, url, body, token) {
  return agent[method](url)
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .set('Referrer', '/')
    .send({ ...body, _csrf: token });
}

describe('Features', function() {
  const alice = request.agent(app);
  const bob = request.agent(app);
  let aliceUser, bobUser;

  before(async function() {
    aliceUser = await createVerifiedUser(alice, db, { email: 'alice@example.com', name: 'Alice' });
    bobUser = await createVerifiedUser(bob, db, { email: 'bob@example.com', name: 'Bob' });
  });

  describe('Wikidata facts', function() {
    const { extractFacts } = require('../lib/carinfo');

    it('extracts labelled items, production years and known-unit quantities', function() {
      const entity = {
        claims: {
          P279: [{ mainsnak: { datavalue: { value: { id: 'Q1' } } } }],
          P155: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }],
          P571: [{ mainsnak: { datavalue: { value: { time: '+1974-00-00T00:00:00Z' } } } }],
          P2669: [{ mainsnak: { datavalue: { value: { time: '+1990-00-00T00:00:00Z' } } } }],
          P2052: [{ mainsnak: { datavalue: { value: { amount: '+290', unit: 'http://www.wikidata.org/entity/Q180154' } } } }],
          P2067: [{ mainsnak: { datavalue: { value: { amount: '+1450', unit: 'http://www.wikidata.org/entity/Q999' } } } }],
          P287: [{ rank: 'deprecated', mainsnak: { datavalue: { value: { id: 'Q3' } } } }]
        }
      };
      const facts = extractFacts(entity, { Q1: 'supercar', Q2: 'Lamborghini Miura', Q3: 'Nobody' });
      const byLabel = Object.fromEntries(facts.map(f => [f.label, f]));
      if (byLabel.Class.values[0] !== 'supercar') throw new Error('class missing');
      if (!byLabel['Preceded by'].link) throw new Error('predecessor should link');
      if (byLabel.Produced.values[0] !== '1974–1990') throw new Error('production years wrong');
      if (byLabel['Top speed'].values[0] !== '290 km/h') throw new Error('top speed wrong');
      if (byLabel.Weight) throw new Error('unknown unit should be skipped');
      if (byLabel.Designer) throw new Error('deprecated claim should be skipped');
    });
  });

  describe('Model years', function() {
    const nhtsa = require('../lib/nhtsa');
    const { scanMake } = require('../jobs/years');
    let original;

    before(function() { original = nhtsa.getModelYears; });
    after(function() { nhtsa.getModelYears = original; });

    it('records year ranges and marks the make scanned', async function() {
      await db.car.bulkCreate([
        { make: 'Lotus', model: 'Elise', image: PLACEHOLDER_URL, favcount: 0, updated_img: false },
        { make: 'Lotus', model: 'Esprit', image: PLACEHOLDER_URL, favcount: 0, updated_img: false }
      ]);
      nhtsa.getModelYears = async () => new Map([['Elise', [1996, 1997, 1998, 2005, 2006]]]);
      await scanMake('Lotus');

      const elise = await db.car.findOne({ where: { make: 'Lotus', model: 'Elise' } });
      const esprit = await db.car.findOne({ where: { make: 'Lotus', model: 'Esprit' } });
      if (elise.year_min !== 1996 || elise.year_max !== 2006) throw new Error('bounds not stored');
      if (elise.model_years.join() !== '1996,1997,1998,2005,2006') throw new Error('years not stored');
      if (!elise.years_checked || !esprit.years_checked) throw new Error('make not marked scanned');
      if (esprit.year_min !== null) throw new Error('undated model should stay null');
    });

    it('serves the catalog years to the add-car year dropdown', async function() {
      const res = await alice.get('/garage/years?make=Lotus&model=Elise').expect(200);
      if (res.body.join() !== '2006,2005,1998,1997,1996') throw new Error('wrong years: ' + res.body.join());
    });

    it('formats production runs, keeping real gaps', function() {
      const { formatYears } = require('../lib/carinfo');
      const supra = { model_years: [1981, 1982, 1983, 1997, 1998, 2020, 2021] };
      if (formatYears(supra) !== '1981–1983, 1997–1998, 2020–2021') throw new Error(formatYears(supra));
      if (formatYears({ model_years: [2001, 2003] }) !== '2001–2003') throw new Error('one-year gap not bridged');
      if (formatYears({ model_years: [2010] }) !== '2010') throw new Error('single year wrong');
      if (formatYears(null) !== null) throw new Error('null car');
    });
  });

  describe('Photo gallery', function() {
    let car, imgA, imgB;

    before(async function() {
      car = await db.car.create({ make: 'Mazda', model: 'RX-7', image: PLACEHOLDER_URL, favcount: 0, updated_img: false });
      const { addImage } = require('../lib/gallery');
      imgA = await addImage(car.id, 'https://example.com/rx7-a.jpg', { source: 'catalog' });
      imgB = await addImage(car.id, 'https://example.com/rx7-b.jpg', { source: 'user' });
    });

    it('makes the first image of a placeholder car its hero', async function() {
      const fresh = await db.car.findByPk(car.id);
      if (fresh.image !== imgA.url || !fresh.updated_img) throw new Error('first image did not become hero');
    });

    it('re-points the hero at the top-voted image', async function() {
      const token = await getCsrfToken(alice, '/garage');
      const res = await form(alice, 'post', `/cars/images/${imgB.id}/vote`, { value: '1' }, token)
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(200);
      if (res.body.score !== 1 || res.body.heroUrl !== imgB.url) throw new Error('vote result wrong: ' + JSON.stringify(res.body));
      const fresh = await db.car.findByPk(car.id);
      if (fresh.image !== imgB.url) throw new Error('hero not updated');
    });

    it('counts one vote per user and lets a vote be changed or cleared', async function() {
      const token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/cars/images/${imgB.id}/vote`, { value: '1' }, token).set('X-Requested-With', 'XMLHttpRequest').expect(200);
      let img = await db.car_image.findByPk(imgB.id);
      if (img.score !== 1) throw new Error('double vote counted');

      await form(alice, 'post', `/cars/images/${imgB.id}/vote`, { value: '-1' }, token).set('X-Requested-With', 'XMLHttpRequest').expect(200);
      img = await db.car_image.findByPk(imgB.id);
      if (img.score !== -1) throw new Error('vote change not applied');

      await form(alice, 'post', `/cars/images/${imgB.id}/vote`, { value: '0' }, token).set('X-Requested-With', 'XMLHttpRequest').expect(200);
      img = await db.car_image.findByPk(imgB.id);
      if (img.score !== 0) throw new Error('vote not cleared');
    });

    it('rejects out-of-range vote values', async function() {
      const token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/cars/images/${imgA.id}/vote`, { value: '5' }, token).set('X-Requested-With', 'XMLHttpRequest').expect(400);
    });

    it('accepts photo proposals for cars that already have an image, and approval adds to the gallery', async function() {
      const token = await getCsrfToken(bob, '/garage');
      await form(bob, 'post', '/cars/propose-image', { carId: car.id, imageUrl: 'https://example.com/rx7-c.jpg' }, token).expect(302);
      const proposal = await db.image_proposal.findOne({ where: { carId: car.id, userId: bobUser.id } });
      if (!proposal) throw new Error('proposal not created for a car with an image');

      // Duplicate of a gallery image is refused
      await form(bob, 'post', '/cars/propose-image', { carId: car.id, imageUrl: imgA.url }, token).expect(302);
      if (await db.image_proposal.count({ where: { carId: car.id, imageUrl: imgA.url } })) throw new Error('duplicate accepted');

      await db.user.update({ isAdmin: true }, { where: { id: aliceUser.id } });
      const adminToken = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/garage/admin/proposal/${proposal.id}/approve`, {}, adminToken).expect(302);
      await db.user.update({ isAdmin: false }, { where: { id: aliceUser.id } });

      const added = await db.car_image.findOne({ where: { carId: car.id, url: 'https://example.com/rx7-c.jpg' } });
      if (!added || added.userId !== bobUser.id) throw new Error('approved photo missing from gallery');
    });
  });

  describe('Spotting + Dex', function() {
    let car;

    before(async function() {
      car = await db.car.create({ make: 'Datsun', model: '240Z', image: PLACEHOLDER_URL, favcount: 0, updated_img: false });
      await db.car.create({ make: 'Datsun', model: '510', image: PLACEHOLDER_URL, favcount: 0, updated_img: false });
    });

    it('logs a spot and counts distinct cars toward the make', async function() {
      const token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', '/cars/spot', { make: 'Datsun', model: '240Z', location: 'PCH', _csrf: token }, token).expect(302);
      await form(alice, 'post', '/cars/spot', { make: 'Datsun', model: '240Z', _csrf: token }, token).expect(302);
      const spots = await db.spotting.count({ where: { userId: aliceUser.id, carId: car.id } });
      if (spots !== 2) throw new Error(`expected 2 spots, got ${spots}`);

      const { getDexStats, getBadges } = require('../lib/dex');
      const dex = await getDexStats(aliceUser.id);
      const datsun = dex.makes.find(m => m.make === 'Datsun');
      if (!datsun || datsun.spotted !== 1 || datsun.total !== 2) throw new Error('dex progress wrong: ' + JSON.stringify(datsun));
      const badges = await getBadges(aliceUser.id, dex);
      if (!badges.find(b => b.id === 'first-spot').earned) throw new Error('First Spot not earned');
      if (badges.find(b => b.id === 'spotter').earned) throw new Error('Spotter earned too early');
    });

    it('rejects a spot with an unsafe photo URL', async function() {
      const before = await db.spotting.count();
      const token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', '/cars/spot', { make: 'Datsun', model: '240Z', imageUrl: 'javascript:alert(1)' }, token).expect(302);
      if (await db.spotting.count() !== before) throw new Error('unsafe spot saved');
    });

    it("won't let another user delete your spot", async function() {
      const spot = await db.spotting.findOne({ where: { userId: aliceUser.id } });
      const token = await getCsrfToken(bob, '/garage');
      await form(bob, 'post', `/garage/spot/${spot.id}?_method=DELETE`, {}, token).expect(302);
      if (!await db.spotting.findByPk(spot.id)) throw new Error('IDOR: spot deleted by another user');
    });

    it('shows Dex and badges on the garage page', async function() {
      const res = await alice.get('/garage').expect(200);
      if (!res.text.includes('My Dex') || !res.text.includes('First Spot')) throw new Error('dex section missing');
    });
  });

  describe('Garage car: VIN + maintenance', function() {
    let myCar;

    it('stores a valid VIN and refuses a malformed one', async function() {
      let token = await getCsrfToken(alice, '/garage/add');
      await form(alice, 'post', '/garage/add', { make: 'Honda', model: 'Accord', year: '2003', vin: '1hgcm82633a004352' }, token)
        .expect('Location', '/garage');
      myCar = await db.user_car.findOne({ where: { userId: aliceUser.id, make: 'Honda', model: 'Accord' } });
      if (!myCar || myCar.vin !== '1HGCM82633A004352') throw new Error('VIN not normalized/stored');

      token = await getCsrfToken(alice, '/garage/add');
      await form(alice, 'post', '/garage/add', { make: 'Honda', model: 'Civic', year: '2003', vin: 'IOQ123' }, token)
        .expect('Location', '/garage/add');
      if (await db.user_car.count({ where: { userId: aliceUser.id, model: 'Civic' } })) throw new Error('bad VIN accepted');
    });

    it('validates VINs before calling NHTSA', async function() {
      await alice.get('/garage/vin?vin=TOO-SHORT').expect(400);
    });

    it('adds and deletes maintenance entries, owner only', async function() {
      let token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/garage/car/${myCar.id}/maintenance`, {
        date: '2026-09-01', title: 'Oil change', mileage: '42,000', cost: '$59.99'
      }, token).expect(302);
      const log = await db.maintenance_log.findOne({ where: { userCarId: myCar.id } });
      if (!log || log.mileage !== 42000 || parseFloat(log.cost) !== 59.99) throw new Error('entry not parsed/saved');

      // Bob can't add to or delete from Alice's car
      const bobToken = await getCsrfToken(bob, '/garage');
      await form(bob, 'post', `/garage/car/${myCar.id}/maintenance`, { date: '2026-09-02', title: 'Hijack' }, bobToken).expect(302);
      await form(bob, 'post', `/garage/car/${myCar.id}/maintenance/${log.id}?_method=DELETE`, {}, bobToken).expect(302);
      if (await db.maintenance_log.count({ where: { userCarId: myCar.id } }) !== 1) throw new Error('IDOR on maintenance log');
      await bob.get(`/garage/car/${myCar.id}`).expect(404);

      token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', `/garage/car/${myCar.id}/maintenance`, { date: 'yesterday', title: 'Bad date' }, token).expect(302);
      if (await db.maintenance_log.count({ where: { userCarId: myCar.id } }) !== 1) throw new Error('invalid date accepted');

      await form(alice, 'post', `/garage/car/${myCar.id}/maintenance/${log.id}?_method=DELETE`, {}, token).expect(302);
      if (await db.maintenance_log.count({ where: { userCarId: myCar.id } }) !== 0) throw new Error('owner could not delete');
    });
  });

  describe('Public garages', function() {
    it('keeps garages private until a username is set and public is on', async function() {
      let token = await getCsrfToken(alice, '/garage');
      // Public without a username is refused
      await form(alice, 'post', '/garage/settings', { garagePublic: 'on' }, token).expect(302);
      let fresh = await db.user.findByPk(aliceUser.id);
      if (fresh.garagePublic) throw new Error('went public without a username');

      token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', '/garage/settings', { username: 'Alice_Drives' }, token).expect(302);
      await request(app).get('/u/alice_drives').expect(404);

      token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', '/garage/settings', { username: 'alice_drives', garagePublic: 'on' }, token).expect(302);
      fresh = await db.user.findByPk(aliceUser.id);
      if (fresh.username !== 'alice_drives' || !fresh.garagePublic) throw new Error('settings not saved');
    });

    it('renders the public page without email, VIN or notes', async function() {
      await db.user_car.update({ notes: 'secret spare key under bumper' }, { where: { userId: aliceUser.id } });
      const res = await request(app).get('/u/Alice_Drives').expect(200);
      if (!res.text.includes("Alice's Garage")) throw new Error('title missing');
      if (res.text.includes('alice@example.com')) throw new Error('email leaked');
      if (res.text.includes('1HGCM82633A004352')) throw new Error('VIN leaked');
      if (res.text.includes('secret spare key')) throw new Error('notes leaked');
      if (!/property="og:title" content="Alice&#39;s Garage on AutoDex"/.test(res.text)) throw new Error('OG title missing');
    });

    it('rejects reserved and taken usernames', async function() {
      let token = await getCsrfToken(bob, '/garage');
      await form(bob, 'post', '/garage/settings', { username: 'admin' }, token).expect(302);
      token = await getCsrfToken(bob, '/garage');
      await form(bob, 'post', '/garage/settings', { username: 'ALICE_DRIVES' }, token).expect(302);
      const fresh = await db.user.findByPk(bobUser.id);
      if (fresh.username) throw new Error('reserved/taken username accepted: ' + fresh.username);
    });

    it('lists public garages in the sitemap', async function() {
      const res = await request(app).get('/sitemap.xml').expect(200);
      if (!res.text.includes('/u/alice_drives')) throw new Error('public garage missing from sitemap');
    });
  });

  describe('Favorites', function() {
    it('refuses cars that are not in the catalog', async function() {
      const token = await getCsrfToken(alice, '/garage');
      await form(alice, 'post', '/cars/fav', { favecar_make: 'Toyota', favecar_model: 'Definitely Not A Real Model 9000' }, token)
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(404);
      if (await db.car.count({ where: { model: 'Definitely Not A Real Model 9000' } })) throw new Error('junk car created');
    });
  });

  describe('Compare', function() {
    it('renders an empty state and ignores malformed params', async function() {
      const res = await request(app).get('/cars/compare?c=nopipe&c=|&c=Make|').expect(200);
      if (!res.text.includes('Nothing to compare yet')) throw new Error('empty state missing');
      if (!/name="robots" content="noindex/.test(res.text)) throw new Error('compare should be noindex');
    });
  });
});
