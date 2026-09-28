const request = require('supertest');
const axios = require('axios');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
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
      const hero = url => new RegExp(`class="car-hero" style="background-image: url\\('${url.replace(/[.?]/g, '\\$&')}'\\)`);
      const page = '/cars/car?make=Mazda&model=MX-5%20Miata&image=';
      let galleryUrl;

      before(async function() {
        galleryUrl = (await addImage(miata.id, 'https://example.com/miata-gallery.jpg', { source: 'user' })).url;
      });

      it('ignores an arbitrary image, in the page and its share preview', async function() {
        const res = await request(app).get(page + encodeURIComponent('https://example.com/evil.jpg')).expect(200);
        if (res.text.includes('evil.jpg')) throw new Error('arbitrary image rendered');
        if (!hero(miata.image).test(res.text)) throw new Error('catalog image not used');
        if (!res.text.includes(`property="og:image" content="${miata.image}"`)) throw new Error('og:image not the catalog photo');
      });

      it("shows a gallery photo or the viewer's own favorite photo", async function() {
        let res = await request(app).get(page + encodeURIComponent(galleryUrl)).expect(200);
        if (!hero(galleryUrl).test(res.text)) throw new Error('gallery photo not shown');
        if (!res.text.includes(`property="og:image" content="${miata.image}"`)) throw new Error('og:image followed the query');

        const agent = request.agent(app);
        await createVerifiedUser(agent, db, { email: 'miata-fan@example.com' });
        const token = await getCsrfToken(agent, '/garage');
        const mine = 'https://example.com/my-miata.jpg';
        await agent.post('/cars/fav').type('form').set('X-Requested-With', 'XMLHttpRequest')
          .send({ favecar_make: 'Mazda', favecar_model: 'MX-5 Miata', favecar_image: mine, _csrf: token })
          .expect(200);
        res = await agent.get(page + encodeURIComponent(mine)).expect(200);
        if (!hero(mine).test(res.text)) throw new Error('own favorite photo not shown');
        res = await request(app).get(page + encodeURIComponent(mine)).expect(200);
        if (hero(mine).test(res.text)) throw new Error("someone else's favorite photo shown");
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

    it('treats LIKE wildcards as plain text', async function() {
      await request(app).get('/search?q=honda%20%25').expect(302).expect('Location', '/cars?selectmake=Honda');
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
