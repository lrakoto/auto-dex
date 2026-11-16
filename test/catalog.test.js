const assert = require('node:assert/strict');
const request = require('supertest');
const axios = require('axios');
const { escapeXML } = require('ejs');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { cacheClear } = require('../lib/cache');
const { addImage } = require('../lib/gallery');
const { buildTimeline } = require('../lib/timeline');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { PLACEHOLDER_URL } = require('../lib/constants');

// NHTSA and the Wikipedia/Wikidata/FuelEconomy lookups are stubbed here, so
// these tests can count calls and don't depend on the network.
function stubLookups(listed) {
  const real = {
    getModels: carquery.getModels,
    getWikiSummary: carinfo.getWikiSummary,
    getFuelSpecs: carinfo.getFuelSpecs,
    getWikidataFacts: carinfo.getWikidataFacts
  };
  const calls = { models: [], info: [] };
  carquery.getModels = async make => {
    calls.models.push(make);
    return (listed[make] || []).map(model => ({ make, model }));
  };
  carinfo.getWikiSummary = async (make, model) => { calls.info.push(`${make} ${model}`); return null; };
  carinfo.getFuelSpecs = async () => null;
  carinfo.getWikidataFacts = async () => [];
  return {
    calls,
    restore() {
      carquery.getModels = real.getModels;
      carinfo.getWikiSummary = real.getWikiSummary;
      carinfo.getFuelSpecs = real.getFuelSpecs;
      carinfo.getWikidataFacts = real.getWikidataFacts;
    }
  };
}

describe('Catalog', function() {
  describe('NHTSA vehicle types', function() {
    let realGet;
    before(function() {
      realGet = axios.get;
      carquery.clearModelsCache();
      cacheClear();
    });
    after(async function() {
      axios.get = realGet;
      carquery.clearModelsCache();
      cacheClear();
      await db.sequelize.query("DELETE FROM api_cache WHERE key LIKE '%/make/Rivian/%'");
    });

    it('lists cars, SUVs and pickups only, for the exact make', async function() {
      const asked = [];
      axios.get = async url => {
        asked.push(url);
        const type = decodeURIComponent(url.split('/vehicletype/')[1].split('?')[0]);
        const results = {
          car: [{ Make_Name: 'RIVIAN', Model_Name: 'R2' }],
          mpv: [{ Make_Name: 'RIVIAN', Model_Name: 'R1S' }, { Make_Name: 'RIVIAN', Model_Name: 'R2' }],
          truck: [{ Make_Name: 'RIVIAN', Model_Name: 'R1T' }, { Make_Name: 'RIVIAN TRAILERS', Model_Name: 'Hauler' }]
        }[type] || [{ Make_Name: 'RIVIAN', Model_Name: 'Scooter' }];
        return { data: { Results: results } };
      };
      const models = (await carquery.getModels('Rivian')).map(m => m.model);
      if (models.join() !== 'R1S,R1T,R2') throw new Error('wrong models: ' + models.join());
      if (asked.length !== 3 || !asked.every(u => /\/vehicletype\/(car|mpv|truck)\?/.test(u))) {
        throw new Error('asked for the wrong vehicle types: ' + asked.join(' '));
      }
    });
  });

  it('links only the exact local preview car to the 3D lab when explicitly enabled', async function () {
    const lookups = stubLookups({});
    const realNhtsa = { getSafetyRatings: nhtsa.getSafetyRatings, getComplaints: nhtsa.getComplaints };
    const previous = { NODE_ENV: process.env.NODE_ENV, ENABLE_3D_DEMO: process.env.ENABLE_3D_DEMO };
    const make = 'AutoDex Lab';
    const models = ['Khronos Toy Car', 'Khronos Toy Car Sport'];
    const page = model => '/cars/car?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model);
    const previewId = /\bid="local-3d-preview"/;
    const previewLink = /<a\b(?=[^>]*\bid="local-3d-preview")(?=[^>]*\bhref="\/dev\/3d")[^>]*>/;
    const fixtureIds = [];

    nhtsa.getSafetyRatings = async () => null;
    nhtsa.getComplaints = async () => null;
    try {
      const fixtures = await db.car.bulkCreate(models.map(model => ({
        make, model, image: PLACEHOLDER_URL, favcount: 0, vehicle_type: 'car'
      })));
      fixtureIds.push(...fixtures.map(row => row.id));
      const [exact, near] = models;

      process.env.NODE_ENV = 'test';
      delete process.env.ENABLE_3D_DEMO;
      assert.doesNotMatch((await request(app).get(page(exact)).expect(200)).text, previewId);

      process.env.ENABLE_3D_DEMO = '1';
      const enabled = await request(app).get(page(exact)).expect(200).expect('Cache-Control', 'no-store');
      assert.match(enabled.text, previewLink);
      assert.match(enabled.text, /name="robots" content="noindex, nofollow"/);
      assert.doesNotMatch(enabled.text, /<model-viewer\b|\/js\/car-3d-demo\.js|\/dev\/3d\/assets\//i);
      assert.doesNotMatch((await request(app).get(page(near)).expect(200)).text, previewId);

      // The real app remains loaded against the test DB throughout this test.
      await fixtures[0].update({ vehicle_type: 'motorcycle' });
      assert.doesNotMatch((await request(app).get(page(exact)).expect(200)).text, previewId);
      await fixtures[0].update({ vehicle_type: 'car' });

      process.env.NODE_ENV = 'production';
      assert.doesNotMatch((await request(app).get(page(exact)).expect(200)).text, previewId);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      Object.assign(nhtsa, realNhtsa);
      lookups.restore();
      if (fixtureIds.length) await db.car.destroy({ where: { id: fixtureIds } });
    }
  });

  describe('car and make URLs', function() {
    let stub, miata;

    before(async function() {
      stub = stubLookups({ Mazda: ['MX-5 Miata', 'CX-90'] });
      miata = await db.car.create({
        make: 'Mazda', model: 'MX-5 Miata', image: 'https://example.com/miata.jpg', favcount: 2, updated_img: true
      });
    });
    after(function() { stub.restore(); });

    it('redirects other spellings to the catalog spelling', async function() {
      await request(app).get('/cars/car?make=mazda&model=mx-5%20miata')
        .expect(301).expect('Location', '/cars/car?make=Mazda&model=MX-5%20Miata');
      await request(app).get('/cars?selectmake=mazda&year=1990')
        .expect(301).expect('Location', '/cars?selectmake=Mazda&year=1990');
    });

    it('keeps an exact stored commercial make on its detail, listing, and timeline links', async function() {
      const fixtures = await db.car.bulkCreate([
        { make: 'RIVIAN', model: 'EDV', vehicle_type: 'commercial' },
        { make: 'Rivian', model: 'R1T', vehicle_type: 'car' }
      ].map(row => ({
        ...row, image: PLACEHOLDER_URL, favcount: 0, model_years: [2023], year_min: 2023, year_max: 2023
      })));
      const getComplaints = nhtsa.getComplaints;
      nhtsa.getComplaints = async () => null;
      try {
        const detail = await request(app).get('/cars/car?make=RIVIAN&model=EDV').expect(200);
        const breadcrumb = detail.text.match(/href="([^"]+)" class="btn btn-outline-secondary btn-sm">&larr; RIVIAN<\/a>/)?.[1];
        assert.equal(breadcrumb, '/cars?selectmake=RIVIAN&amp;type=commercial');
        const listingPath = breadcrumb.replace('&amp;', '&');
        const listing = await request(app).get(listingPath).expect(200);
        assert.match(listing.text, /class="card-model">EDV<\/span>/);
        assert.match(listing.text, /rel="canonical" href="[^"]*\/cars\?selectmake=RIVIAN&amp;type=commercial"/);
        assert.match(listing.text, /name="selectmake" value="RIVIAN"/);
        assert.match(listing.text, /name="type" value="commercial"/);
        const filtered = await request(app).get(`${listingPath}&year=2023`).expect(200);
        assert.match(filtered.text, /<option value="2023" selected>/);
        assert.match(filtered.text, /class="card-model">EDV<\/span>/);

        const timeline = detail.text.match(/href="([^"]+)" class="browse-link">Timeline<\/a>/)?.[1];
        assert.equal(timeline, '/cars/timeline?make=RIVIAN&amp;type=commercial');
        const chart = await request(app).get(timeline.replace('&amp;', '&')).expect(200);
        assert.match(chart.text, /class="timeline-label" title="EDV">EDV<\/span>/);
        assert.match(chart.text, /rel="canonical" href="[^"]*\/cars\/timeline\?make=RIVIAN&amp;type=commercial"/);

        await request(app).get('/cars?selectmake=riViAn&type=commercial&year=2023').expect(301)
          .expect('Location', '/cars?selectmake=Rivian&type=commercial&year=2023');
        const curated = await request(app).get('/cars?selectmake=Rivian').expect(200);
        assert.match(curated.text, /class="card-model">R1T<\/span>/);
        assert.doesNotMatch(curated.text, /class="card-model">EDV<\/span>/);
      } finally {
        nhtsa.getComplaints = getComplaints;
        await db.car.destroy({ where: { id: fixtures.map(row => row.id) } });
      }
    });

    it('serves models NHTSA lists that have no row yet', async function() {
      await request(app).get('/cars/car?make=Mazda&model=CX-90').expect(200);
    });

    it('404s unknown cars without any external lookup or cache write', async function() {
      const [[{ n: before }]] = await db.sequelize.query('SELECT COUNT(*)::int AS n FROM api_cache');
      stub.calls.info.length = 0;
      await request(app).get('/cars/car?make=Zzz&model=Qqq').expect(404);
      await request(app).get('/cars/car?make=Mazda&model=Definitely%20Not').expect(404);
      const [[{ n: after }]] = await db.sequelize.query('SELECT COUNT(*)::int AS n FROM api_cache');
      if (stub.calls.info.length) throw new Error('looked up: ' + stub.calls.info.join(', '));
      if (after !== before) throw new Error('cached lookups for a junk URL');
    });

    it('404s unknown makes without asking NHTSA', async function() {
      stub.calls.models.length = 0;
      const res = await request(app).get('/cars?selectmake=NotAMake').expect(404);
      if (stub.calls.models.length) throw new Error('asked NHTSA about ' + stub.calls.models.join());
      if (!res.text.includes('Wrong turn')) throw new Error('404 page missing');
    });

    it('compares catalog cars only', async function() {
      stub.calls.info.length = 0;
      const res = await request(app).get('/cars/compare?c=Zzz|Qqq&c=Mazda|MX-5%20Miata').expect(200);
      if (!res.text.includes('MX-5 Miata') || res.text.includes('Qqq')) throw new Error('wrong cars compared');
      if (stub.calls.info.join() !== 'Mazda MX-5 Miata') throw new Error('looked up: ' + stub.calls.info.join());
    });

    describe('?image=', function() {
      const hasHero = (html, url) => html.includes(`class="car-hero" style="background-image: url(${escapeXML(JSON.stringify(url))}), url(&#34;/assets/no-photo.svg&#34;);"`);
      const page = '/cars/car?make=Mazda&model=MX-5%20Miata&image=';
      let galleryUrl;

      before(async function() {
        galleryUrl = (await addImage(miata.id, 'https://example.com/miata-gallery.jpg', { source: 'user' })).url;
      });

      it('ignores an arbitrary image, in the page and its share preview', async function() {
        const res = await request(app).get(page + encodeURIComponent('https://example.com/evil.jpg')).expect(200);
        if (res.text.includes('evil.jpg')) throw new Error('arbitrary image rendered');
        if (!hasHero(res.text, miata.image)) throw new Error('catalog image not used');
        if (!res.text.includes(`property="og:image" content="${miata.image}"`)) throw new Error('og:image not the catalog photo');
      });

      it("shows a gallery photo or the viewer's own favorite photo", async function() {
        let res = await request(app).get(page + encodeURIComponent(galleryUrl)).expect(200);
        if (!hasHero(res.text, galleryUrl)) throw new Error('gallery photo not shown');
        if (!res.text.includes(`property="og:image" content="${miata.image}"`)) throw new Error('og:image followed the query');

        const agent = request.agent(app);
        await createVerifiedUser(agent, db, { email: 'miata-fan@example.com' });
        const token = await getCsrfToken(agent, '/garage');
        const mine = 'https://example.com/my-miata.jpg';
        await agent.post('/cars/fav').type('form').set('X-Requested-With', 'XMLHttpRequest')
          .send({ favecar_make: 'Mazda', favecar_model: 'MX-5 Miata', favecar_image: mine, _csrf: token })
          .expect(200);
        res = await agent.get(page + encodeURIComponent(mine)).expect(200);
        if (!hasHero(res.text, mine)) throw new Error('own favorite photo not shown');
        res = await request(app).get(page + encodeURIComponent(mine)).expect(200);
        if (hasHero(res.text, mine)) throw new Error("someone else's favorite photo shown");
      });

      it('quotes photo filenames safely and keeps a local fallback behind the hero', async function() {
        const quoted = "https://example.com/owner's-car.jpg?width=1280&label=\"roadster\"";
        const original = miata.image;
        // Automated catalog URLs do not pass through the user-input validator.
        await miata.update({ image: quoted });
        try {
          const res = await request(app).get(page).expect(200);
          if (!hasHero(res.text, quoted)) throw new Error('quoted photo URL or fallback lost');
          await miata.reload();
          if (miata.image !== quoted) throw new Error('rendering changed the stored photo');
        } finally {
          await miata.update({ image: original });
        }
      });
    });

    it('renders the edit-favorite modal before there is a favorite', async function() {
      const agent = request.agent(app);
      await createVerifiedUser(agent, db, { email: 'not-yet-a-fan@example.com' });
      const res = await agent.get('/cars/car?make=Mazda&model=CX-90').expect(200);
      if (!res.text.includes('id="detailEditFavModal"') || !res.text.includes('id="detail-fav-upload-form"')) {
        throw new Error('edit modal missing, so Edit Favorite after an in-page favorite does nothing');
      }
    });
  });

  describe('search', function() {
    before(async function() {
      await db.car.findOrCreate({ where: { make: 'Honda', model: 'Civic' }, defaults: { image: PLACEHOLDER_URL, favcount: 1, updated_img: false } });
      await db.car.findOrCreate({ where: { make: 'Honda', model: 'Civic Type R' }, defaults: { image: PLACEHOLDER_URL, favcount: 50, updated_img: false } });
    });

    it('jumps to the exact model in any case, not a more popular longer one', async function() {
      await request(app).get('/search?q=honda%20civic').expect(302).expect('Location', '/cars/car?make=Honda&model=Civic');
      await request(app).get('/search?q=HONDA%20CIVIC%20TYPE').expect(302).expect('Location', '/cars/car?make=Honda&model=Civic%20Type%20R');
    });

    it('opens a whole model when a submitted make-and-model search uses different spacing', async function() {
      await request(app).get('/search').query({ q: 'HoNdA Civic  Type\tR' })
        .expect(302).expect('Location', '/cars/car?make=Honda&model=Civic%20Type%20R');
    });

    it('accepts extra spacing in a make and preserves the literal model lookup', async function() {
      const rows = await db.car.bulkCreate([
        { make: 'Signal', model: 'Works ZX  9Q', favcount: 100 },
        { make: 'Signal Works', model: 'ZX  9Q', favcount: 1 },
        { make: 'Signal Works', model: 'ZX 9Q', favcount: 50 }
      ].map(row => ({ ...row, image: PLACEHOLDER_URL })));
      const lookups = stubLookups({});
      const getMakes = carquery.getMakes;
      carquery.getMakes = async () => [{ display: 'Signal' }, { display: 'Signal Works' }];
      try {
        const q = 'SiGnAl  wOrKs\tZX  9Q';
        await request(app).get('/search').query({ q }).expect(302)
          .expect('Location', '/cars/car?make=Signal%20Works&model=ZX%20%209Q');
        const suggestions = await request(app).get('/suggest').query({ q }).expect(200);
        assert.deepEqual(suggestions.body.makes, []);
        assert.deepEqual(suggestions.body.models.map(({ make, model }) => [make, model]), [
          ['Signal Works', 'ZX  9Q'], ['Signal Works', 'ZX 9Q']
        ]);

        const makeOnly = 'Signal\tWorks';
        await request(app).get('/search').query({ q: makeOnly }).expect(302)
          .expect('Location', '/cars?selectmake=Signal%20Works');
        const makeSuggestions = await request(app).get('/suggest').query({ q: makeOnly }).expect(200);
        assert.equal(makeSuggestions.body.makes[0], 'Signal Works');

        await request(app).get('/search').query({ q: 'Signal\tWorks\tZX   9Q' }).expect(302)
          .expect('Location', '/cars?selectmake=Signal%20Works');
        await request(app).get('/search').query({ q: 'SignalWorks' }).expect(302)
          .expect('Location', '/cars/search?q=SignalWorks');
      } finally {
        carquery.getMakes = getMakes;
        lookups.restore();
        await db.car.destroy({ where: { id: rows.map(row => row.id) } });
      }
    });

    it('keeps literal search matches and only opens unambiguous spacing matches within the make', async function() {
      const models = await db.car.bulkCreate([
        { make: 'Honda', model: 'Spacing A5', favcount: 0 },
        { make: 'Honda', model: 'Spacing A 5', favcount: 40 },
        { make: 'Toyota', model: 'Spacing B5', favcount: 0 }
      ].map(row => ({ ...row, image: PLACEHOLDER_URL })));
      try {
        const cases = [
          ['Honda Spacing A5', '/cars/car?make=Honda&model=Spacing%20A5'],
          ['Honda Spacing  A5', '/cars?selectmake=Honda'],
          ['Honda Spacing B 5', '/cars?selectmake=Honda'],
          ['Toyota Spacing B 5', '/cars/car?make=Toyota&model=Spacing%20B5'],
          ['Toyota SpacingB', '/cars?selectmake=Toyota']
        ];
        for (const [q, location] of cases) {
          await request(app).get('/search').query({ q }).expect(302).expect('Location', location);
        }
      } finally {
        await db.car.destroy({ where: { id: models.map(model => model.id) } });
      }
    });

    it('treats LIKE wildcards as plain text', async function() {
      await request(app).get('/search?q=honda%20%25').expect(302).expect('Location', '/cars?selectmake=Honda');
    });

    it('ranks literal and spacing-equivalent model suggestions before popular variants in the same make', async function() {
      const models = await db.car.bulkCreate([
        { make: 'Toyota', model: 'Q7', favcount: 1 },
        { make: 'Toyota', model: 'Q 7', favcount: 5 },
        { make: 'Audi', model: 'Q 7', favcount: 100 },
        ...Array.from({ length: 15 }, (_, index) => ({ make: 'Toyota', model: `Q7 Sport ${index + 1}`, favcount: 10 }))
      ].map(row => ({ ...row, image: PLACEHOLDER_URL })));
      const lookups = stubLookups({});
      const suggest = async q => (await request(app).get('/suggest').query({ q }).expect(200)).body.models;
      try {
        const literal = await suggest('Toyota Q7');
        assert.equal(literal.length, 15);
        assert.deepEqual(literal.slice(0, 2).map(row => row.model), ['Q7', 'Q 7']);
        assert.ok(literal.every(row => row.make === 'Toyota'));

        const spaced = await suggest('Toyota Q 7');
        assert.deepEqual(spaced.slice(0, 2).map(row => row.model), ['Q 7', 'Q7']);

        const tab = await suggest('Toyota Q\t7');
        assert.deepEqual(tab.map(({ make, model }) => [make, model]), [['Toyota', 'Q 7'], ['Toyota', 'Q7']]);
        assert.deepEqual(lookups.calls.models, []);
      } finally {
        lookups.restore();
        await db.car.destroy({ where: { id: models.map(model => model.id) } });
      }
    });

    it('keeps whole model names from multiple makes in results and suggestions before their caps', async function() {
      const models = await db.car.bulkCreate([
        { make: 'Honda', model: 'ZX9Q', favcount: 3 },
        { make: 'Toyota', model: 'ZX9Q', favcount: 2 },
        { make: 'BMW', model: 'ZX 9Q', favcount: 4 },
        ...Array.from({ length: 49 }, (_, index) => ({ make: 'Toyota', model: `ZX9Q Sport ${index + 1}`, favcount: 10 }))
      ].map(row => ({ ...row, image: PLACEHOLDER_URL })));
      const resultCards = async q => {
        const { text } = await request(app).get('/cars/search').query({ q }).expect(200);
        return Array.from(text.matchAll(/class="card-make">([^<]+)<\/span> <span class="card-model">([^<]+)<\/span>/g),
          ([, make, model]) => [make, model]);
      };
      const suggestions = async q => {
        const { body } = await request(app).get('/suggest').query({ q }).expect(200);
        return body.models.map(({ make, model }) => [make, model]);
      };
      try {
        await request(app).get('/search').query({ q: 'ZX9Q' }).expect(302).expect('Location', '/cars/search?q=ZX9Q');
        const expected = [['Honda', 'ZX9Q'], ['Toyota', 'ZX9Q'], ['BMW', 'ZX 9Q']];
        const literalResults = await resultCards('ZX9Q');
        assert.equal(literalResults.length, 48);
        assert.deepEqual(literalResults.slice(0, 3), expected);
        const literalSuggestions = await suggestions('ZX9Q');
        assert.equal(literalSuggestions.length, 15);
        assert.deepEqual(literalSuggestions.slice(0, 3), expected);

        const spaced = 'ZX\t9Q';
        await request(app).get('/search').query({ q: spaced }).expect(302).expect('Location', '/cars/search?q=ZX%099Q');
        const spacedExpected = [['BMW', 'ZX 9Q'], ['Honda', 'ZX9Q'], ['Toyota', 'ZX9Q']];
        assert.deepEqual(await resultCards(spaced), spacedExpected);
        assert.deepEqual((await suggestions(spaced)).slice(0, 3), spacedExpected);
      } finally {
        await db.car.destroy({ where: { id: models.map(model => model.id) } });
      }
    });
  });

  describe('sessions', function() {
    let stub;
    before(function() { stub = stubLookups({}); });
    after(function() { stub.restore(); });

    it("don't start for anonymous visits to pages without forms", async function() {
      for (const path of ['/', '/makes', '/cars/explore', '/cars/compare']) {
        const res = await request(app).get(path).expect(200);
        if (res.headers['set-cookie']) throw new Error(`${path} started a session`);
      }
    });

    it('do start where a signed-out visitor has a form to post', async function() {
      for (const path of ['/auth/login', '/auth/signup', '/play']) {
        const res = await request(app).get(path).expect(200);
        if (!res.headers['set-cookie']) throw new Error(`${path} has no session for its CSRF token`);
        if (!/name="csrf-token" content="[0-9a-f]{20,}"/.test(res.text)) throw new Error(`${path} has no CSRF token`);
      }
    });
  });

  describe('signup validation', function() {
    before(async function() {
      await db.user.create({ name: 'Taken', email: 'taken@example.com', password: 'password123' });
    });

    it('says what is wrong, the same way for new and registered emails', async function() {
      for (const email of ['taken@example.com', 'brand-new@example.com']) {
        const agent = request.agent(app);
        const token = await getCsrfToken(agent, '/auth/signup');
        await agent.post('/auth/signup').type('form')
          .send({ name: 'Short Pass', email, password: 'short', _csrf: token })
          .expect(302).expect('Location', '/auth/signup');
        const page = await agent.get('/auth/signup').expect(200);
        if (!page.text.includes('Password must be between 8 and 99 characters')) throw new Error(`no reason given for ${email}`);
      }
      if (await db.user.count({ where: { email: 'brand-new@example.com' } })) throw new Error('invalid signup created a user');
    });
  });

  describe('timeline', function() {
    it('preserves a verified model-year gap in the label and timeline segments', function() {
      const xDrive = { make: 'BMW', model: '528i xDrive', model_years: [2009, 2010, 2012, 2013, 2014, 2015, 2016] };
      const label = '2009–2010, 2012–2016';
      assert.equal(carinfo.formatYears(xDrive), label);
      assert.equal(carinfo.formatYears({ ...xDrive, make: 'Fixture' }), '2009–2016');
      assert.equal(carinfo.formatYears({ ...xDrive, model_years: [], year_min: 2010, year_max: 2012 }), '2010–2012');

      const { rows: [row] } = buildTimeline([xDrive], { now: 2026 });
      assert.equal(row.label, label);
      assert.deepEqual(row.segments.map(({ from, to }) => [from, to]), [[2009, 2010], [2012, 2016]]);
    });

    it('lays out runs, gaps and what is still on sale', function() {
      const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
      const t = buildTimeline([
        { make: 'Toyota', model: 'Supra', model_years: [...span(1981, 1998), ...span(2020, 2027)] },
        { make: 'Toyota', model: 'MR2', model_years: span(1985, 2007) },
        { make: 'Toyota', model: 'Undated', model_years: null }
      ], { now: 2026 });
      if (t.rows.map(r => r.model).join() !== 'Supra,MR2') throw new Error('rows: ' + t.rows.map(r => r.model).join());
      if (t.start !== 1981 || t.end !== 2027) throw new Error(`axis ${t.start}–${t.end}`);
      const [supra, mr2] = t.rows;
      if (supra.label !== '1981–1998, 2020–2027' || !supra.current || mr2.current) throw new Error('runs/current wrong');
      const s0 = supra.segments[0];
      if (Math.abs(s0.left) > 1e-9 || Math.abs(s0.width - (18 / 47) * 100) > 1e-9) throw new Error('segment geometry wrong');
      if (!t.ticks.some(k => k.year === 1990 && k.major) || t.ticks.some(k => k.year < 1981)) throw new Error('ticks wrong');
      if (t.currentCount !== 1) throw new Error('current count wrong');
      // Hover labels: after MR2's bar; in the Supra's hiatus (no room either side)
      if (mr2.labelAt.side !== 'left' || Math.abs(mr2.labelAt.pct - (23 / 47) * 100 - (4 / 47) * 100) > 1e-9) throw new Error('MR2 label misplaced');
      if (supra.labelAt.side !== 'left' || Math.abs(supra.labelAt.pct - (18 / 47) * 100) > 1e-9) throw new Error('Supra label not in its gap');
      if (buildTimeline([{ model: 'x', model_years: [] }]) !== null) throw new Error('empty timeline should be null');
    });

    describe('page', function() {
      let stub;
      before(async function() {
        stub = stubLookups({ Porsche: ['944', '718 Cayman'] });
        const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
        await db.car.bulkCreate([
          { make: 'Porsche', model: '944', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, model_years: span(1983, 1991), year_min: 1983, year_max: 1991, years_checked: true },
          { make: 'Porsche', model: '718 Cayman', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, model_years: span(2017, 2027), year_min: 2017, year_max: 2027, years_checked: true },
          // Seeded before the vehicle-type filter: not a listed passenger model
          { make: 'Porsche', model: 'Tractor 218', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, model_years: span(1981, 1985), year_min: 1981, year_max: 1985, years_checked: true }
        ]);
      });
      after(function() { stub.restore(); });

      it('charts the listed models of a make', async function() {
        const res = await request(app).get('/cars/timeline?make=Porsche').expect(200);
        if (!res.text.includes('>944<') || !res.text.includes('>718 Cayman<')) throw new Error('models missing');
        if (res.text.includes('Tractor 218')) throw new Error('unlisted model charted');
        if (!res.text.includes('2 models')) throw new Error('count missing');
        if (!/rel="canonical" href="[^"]*\/cars\/timeline\?make=Porsche"/.test(res.text)) throw new Error('canonical wrong');
      });

      it('is linked from the make page and redirects other spellings', async function() {
        const res = await request(app).get('/cars?selectmake=Porsche').expect(200);
        if (!res.text.includes('/cars/timeline?make=Porsche')) throw new Error('no timeline link on the make page');
        await request(app).get('/cars/timeline?make=porsche').expect(301).expect('Location', '/cars/timeline?make=Porsche');
        await request(app).get('/cars/timeline?make=Nope').expect(404);
      });

      it('has an empty state (noindex) until the year scan reaches a make', async function() {
        const res = await request(app).get('/cars/timeline?make=Bugatti').expect(200);
        if (!res.text.includes('No timeline yet')) throw new Error('empty state missing');
        if (!/name="robots" content="noindex/.test(res.text)) throw new Error('empty timeline should be noindex');
      });
    });
  });
});
