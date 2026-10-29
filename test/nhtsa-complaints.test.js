const request = require('supertest');
const axios = require('axios');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { cacheClear } = require('../lib/cache');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('NHTSA owner complaints', function() {
  describe('lib/nhtsa.getComplaints', function() {
    let realGet;
    beforeEach(function() {
      realGet = axios.get;
      cacheClear();
    });
    afterEach(function() { axios.get = realGet; });

    it('returns null without calling NHTSA when there is no model year', async function() {
      let called = false;
      axios.get = async () => { called = true; return { data: {} }; };
      const complaints = await nhtsa.getComplaints('Honda', 'Civic', null);
      if (complaints !== null) throw new Error('expected null');
      if (called) throw new Error('should not have called NHTSA without a year');
    });

    it('counts complaints and groups them by top-level component', async function() {
      axios.get = async () => ({
        data: {
          results: [
            { components: 'STEERING' },
            { components: 'STEERING:STEERING WHEEL' },
            { components: 'SUSPENSION:FRONT:CONTROL ARM/LINK ASSEMBLY:LOWER' },
            { components: 'STEERING,SUSPENSION:FRONT' }, // one complaint citing two components
            { components: 'ENGINE' }
          ]
        }
      });
      const complaints = await nhtsa.getComplaints('Honda', 'Civic', 2016);
      if (complaints.count !== 5) throw new Error('count wrong: ' + complaints.count);
      const steering = complaints.topComponents.find(c => c.component === 'STEERING');
      const suspension = complaints.topComponents.find(c => c.component === 'SUSPENSION');
      if (!steering || steering.count !== 3) throw new Error('steering count wrong: ' + JSON.stringify(complaints.topComponents));
      if (!suspension || suspension.count !== 2) throw new Error('suspension count wrong: ' + JSON.stringify(complaints.topComponents));
      if (complaints.topComponents[0].component !== 'STEERING') throw new Error('top components not sorted by count');
    });

    it('returns a zero count and no components when NHTSA has nothing on file', async function() {
      axios.get = async () => ({ data: { results: [] } });
      const complaints = await nhtsa.getComplaints('Zzz', 'Qqq', 2024);
      if (complaints.count !== 0 || complaints.topComponents.length !== 0) throw new Error('expected empty result');
      if (complaints.year !== 2024) throw new Error('an empty result keeps the latest year');
    });

    // Fixture names throughout: answers are cached durably across tests
    const complaint = (odiNumber, components) => ({ odiNumber, components });

    it('shows the newest of the last three model years that has complaints', async function() {
      axios.get = async (url, { params } = {}) => {
        if (url.includes('/products/')) return { data: { results: [] } };
        return { data: { results: params.modelYear === 2025 ? [complaint(1, 'ENGINE'), complaint(2, 'ENGINE')] : [] } };
      };
      const complaints = await nhtsa.getComplaints('Fixturekia', 'Wagon', 2027);
      if (complaints.year !== 2025 || complaints.count !== 2) throw new Error(JSON.stringify(complaints));
      if (complaints.countedAs !== null) throw new Error('the plain name answered');
    });

    it('counts the listed names when the plain name is ambiguous, once per complaint', async function() {
      const asked = [];
      axios.get = async (url, { params } = {}) => {
        if (url.includes('/products/')) {
          return { data: { results: [{ model: 'HATCH SEDAN' }, { model: 'HATCH HATCHBACK' }, { model: 'HATCHX' }, { model: 'COUPE' }] } };
        }
        asked.push(params.model);
        if (params.model === 'Hatch') throw Object.assign(new Error('Bad Request'), { response: { status: 400 } });
        if (params.model === 'HATCH SEDAN') return { data: { results: [complaint(10, 'STEERING'), complaint(11, 'ENGINE')] } };
        if (params.model === 'HATCH HATCHBACK') return { data: { results: [complaint(11, 'ENGINE'), complaint(12, 'STEERING')] } };
        return { data: { results: [] } };
      };
      const complaints = await nhtsa.getComplaints('Fixturehonda', 'Hatch', 2026);
      if (complaints.count !== 3) throw new Error('complaint 11 counted twice or missing: ' + complaints.count);
      if (complaints.countedAs.join() !== 'HATCH SEDAN,HATCH HATCHBACK') throw new Error('countedAs: ' + complaints.countedAs);
      if (asked.includes('HATCHX')) throw new Error('HATCHX is a different model');
      // The ambiguous plain name is remembered, not re-asked on the next view
      const plainBefore = asked.filter(m => m === 'Hatch').length;
      await nhtsa.getComplaints('Fixturehonda', 'Hatch', 2026);
      if (asked.filter(m => m === 'Hatch').length !== plainBefore) throw new Error('the 400 was asked again');
    });
  });

  describe('car detail page', function() {
    let real;

    before(async function() {
      real = {
        getComplaints: nhtsa.getComplaints,
        getModels: carquery.getModels,
        getWikiSummary: carinfo.getWikiSummary,
        getFuelSpecs: carinfo.getFuelSpecs,
        getWikidataFacts: carinfo.getWikidataFacts
      };
      nhtsa.getComplaints = async (make, model, year) => {
        if (make === 'Isuzu' && model === 'VehiCross' && year === 2024) {
          return { count: 1080, topComponents: [{ component: 'STEERING', count: 444 }, { component: 'ENGINE', count: 120 }], year: 2023, countedAs: ['VEHICROSS 4WD', 'VEHICROSS 2WD'] };
        }
        if (make === 'Isuzu' && model === 'Trooper') return { count: 0, topComponents: [] };
        return null;
      };
      carquery.getModels = async () => [];
      carinfo.getWikiSummary = async () => null;
      carinfo.getFuelSpecs = async () => null;
      carinfo.getWikidataFacts = async () => [];
      await db.car.findOrCreate({
        where: { make: 'Isuzu', model: 'VehiCross' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, year_max: 2024 }
      });
      await db.car.findOrCreate({
        where: { make: 'Isuzu', model: 'Trooper' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, year_max: 2024 }
      });
      await db.car.findOrCreate({
        where: { make: 'Isuzu', model: 'Ascender' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false }
      });
    });
    after(function() {
      nhtsa.getComplaints = real.getComplaints;
      carquery.getModels = real.getModels;
      carinfo.getWikiSummary = real.getWikiSummary;
      carinfo.getFuelSpecs = real.getFuelSpecs;
      carinfo.getWikidataFacts = real.getWikidataFacts;
    });

    it('shows the complaint count and top components', async function() {
      const res = await request(app).get('/cars/car?make=Isuzu&model=VehiCross').expect(200);
      if (!res.text.includes('Owner Complaints')) throw new Error('complaints box missing');
      if (!res.text.includes('1,080 complaints filed')) throw new Error('count missing: ' + res.text.match(/[\d,]+ complaints? filed[^<]*/));
      if (!res.text.includes('STEERING')) throw new Error('top component missing');
      if (!res.text.includes('444')) throw new Error('component count missing');
      if (!res.text.includes('Owner Complaints — 2023') || !res.text.includes('for the 2023 model year')) throw new Error('the year with complaints is not shown');
      if (!res.text.includes('Counted across VEHICROSS 4WD, VEHICROSS 2WD.')) throw new Error('the counted names are not shown');
    });

    it('says so when NHTSA has no complaints on file', async function() {
      const res = await request(app).get('/cars/car?make=Isuzu&model=Trooper').expect(200);
      if (!res.text.includes('No owner complaints on file')) throw new Error('empty state missing');
    });

    it('omits the complaints box when no model year is known', async function() {
      const res = await request(app).get('/cars/car?make=Isuzu&model=Ascender').expect(200);
      if (res.text.includes('Owner Complaints')) throw new Error('complaints box should not render without a year');
    });
  });
});
