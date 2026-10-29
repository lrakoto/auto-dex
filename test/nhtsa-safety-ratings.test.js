const request = require('supertest');
const axios = require('axios');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { cacheClear } = require('../lib/cache');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('NHTSA safety ratings', function() {
  describe('lib/nhtsa.getSafetyRatings', function() {
    let realGet;
    beforeEach(function() {
      realGet = axios.get;
      cacheClear();
    });
    afterEach(function() { axios.get = realGet; });

    it('returns null without calling NHTSA when there is no model year', async function() {
      let called = false;
      axios.get = async () => { called = true; return { data: {} }; };
      const ratings = await nhtsa.getSafetyRatings('Mazda', 'MX-5 Miata', null);
      if (ratings !== null) throw new Error('expected null');
      if (called) throw new Error('should not have called NHTSA without a year');
    });

    it('looks up the vehicle id for the model year, then its star ratings', async function() {
      const asked = [];
      axios.get = async url => {
        asked.push(url);
        if (url.includes('/modelyear/')) return { data: { Results: [{ VehicleId: 12345 }] } };
        return {
          data: {
            Results: [{
              OverallRating: '5', OverallFrontCrashRating: '4', OverallSideCrashRating: '5', RolloverRating: 'Not Rated'
            }]
          }
        };
      };
      const ratings = await nhtsa.getSafetyRatings('Mazda', 'MX-5 Miata', 2024);
      if (!ratings || ratings.overall !== 5 || ratings.frontal !== 4 || ratings.side !== 5) {
        throw new Error('ratings wrong: ' + JSON.stringify(ratings));
      }
      if (ratings.rollover !== null) throw new Error('"Not Rated" should map to null');
      // The model years are looked up together, in no fixed order
      if (!asked.some(u => u.includes('/modelyear/2024/make/Mazda/model/MX-5%20Miata'))) {
        throw new Error('wrong lookup URLs: ' + asked.join(' '));
      }
      if (!asked.some(u => u.endsWith('/SafetyRatings/VehicleId/12345'))) throw new Error('vehicle id not used: ' + asked.join(' '));
      if (ratings.year !== 2024 || ratings.ratedAs !== null) throw new Error('year/ratedAs: ' + JSON.stringify(ratings));
    });

    it('walks back to the newest rated model year, at most two years', async function() {
      const asked = [];
      const ratedYears = new Set([2025]);
      axios.get = async url => {
        asked.push(url);
        const m = url.match(/\/modelyear\/(\d{4})\//);
        if (m) return { data: { Results: ratedYears.has(Number(m[1])) ? [{ VehicleId: Number(m[1]) }] : [] } };
        return { data: { Results: [{ OverallRating: '4', OverallFrontCrashRating: '4', OverallSideCrashRating: '5', RolloverRating: '4' }] } };
      };
      const ratings = await nhtsa.getSafetyRatings('Toyota', 'Camry', 2027);
      if (!ratings || ratings.year !== 2025 || ratings.overall !== 4) throw new Error('ratings: ' + JSON.stringify(ratings));
      const years = asked.filter(u => u.includes('/model/')).map(u => u.match(/modelyear\/(\d{4})/)[1]).sort().reverse();
      if (years.join() !== '2027,2026,2025') throw new Error('years asked: ' + years.join());

      // A string year works the same, and the newest rated year wins (other
      // model names: answers are cached durably, not just in memory)
      ratedYears.add(2026);
      if ((await nhtsa.getSafetyRatings('Toyota', 'Corolla', '2027')).year !== 2026) throw new Error('newest rated year not preferred');

      // Ratings older than two years back are not borrowed
      ratedYears.clear(); ratedYears.add(2023);
      if (await nhtsa.getSafetyRatings('Toyota', 'Prius', 2026) !== null) throw new Error('went back more than two years');
    });

    it('falls back to the name NHTSA rated the model under', async function() {
      const asked = [];
      axios.get = async url => {
        asked.push(url);
        // Fixture names: answers are cached durably across tests
        if (/\/modelyear\/2026\/make\/Fixturemake$/.test(url)) {
          return { data: { Results: [{ Model: 'ROADSTER HYBRID' }, { Model: 'ROADSTERX' }, { Model: 'COUPE' }] } };
        }
        if (url.includes('/modelyear/2026/make/Fixturemake/model/ROADSTER%20HYBRID')) return { data: { Results: [{ VehicleId: 777 }] } };
        if (url.includes('/modelyear/')) return { data: { Results: [] } };
        return { data: { Results: [{ OverallRating: '5', OverallFrontCrashRating: '4', OverallSideCrashRating: '5', RolloverRating: '4' }] } };
      };
      // "Road" is not "ROADSTERX": whole words only
      if (await nhtsa.getSafetyRatings('Fixturemake', 'Road', 2026) !== null) throw new Error('a different model was borrowed');
      const roadster = await nhtsa.getSafetyRatings('Fixturemake', 'Roadster', 2026);
      if (!roadster || roadster.year !== 2026 || roadster.ratedAs !== 'ROADSTER HYBRID' || roadster.overall !== 5) throw new Error(JSON.stringify(roadster));
      if (!asked.some(u => u.endsWith('/VehicleId/777'))) throw new Error('variant vehicle not fetched');
    });

    it('picks rated names that start with the whole model, preferring a non-hybrid', function() {
      const honda = ['ACCORD HYBRID', 'ACCORD SEDAN', 'Civic Hatchback', 'CIVIC SEDAN', 'CIVIC SEDAN HYBRID', 'CR-V', 'CR-V HYBRID'];
      if (nhtsa.safetyVariant(honda, 'Accord') !== 'ACCORD SEDAN') throw new Error('Accord');
      if (nhtsa.safetyVariant(honda, 'Civic') !== 'Civic Hatchback') throw new Error('Civic (tie broken alphabetically, case-insensitive)');
      if (nhtsa.safetyVariant(honda, 'CR-V') !== 'CR-V HYBRID') throw new Error('CR-V variant');
      if (nhtsa.safetyVariant(['CX-50', 'CX-50 HYBRID'], 'CX-5') !== null) throw new Error('CX-50 borrowed for CX-5');
      if (nhtsa.safetyVariant(honda, 'Pilot') !== null) throw new Error('no variant should be invented');
    });

    it('returns null when NHTSA has no vehicle id for that model year', async function() {
      axios.get = async () => ({ data: { Results: [] } });
      const ratings = await nhtsa.getSafetyRatings('Zzz', 'Qqq', 2024);
      if (ratings !== null) throw new Error('expected null');
    });

    it('returns null when nothing was rated', async function() {
      axios.get = async url => {
        if (url.includes('/modelyear/')) return { data: { Results: [{ VehicleId: 1 }] } };
        return { data: { Results: [{ OverallRating: 'Not Rated' }] } };
      };
      const ratings = await nhtsa.getSafetyRatings('Zzz', 'Qqq', 2024);
      if (ratings !== null) throw new Error('expected null when every category is unrated');
    });
  });

  describe('detail and compare pages', function() {
    let real;

    before(async function() {
      real = {
        getSafetyRatings: nhtsa.getSafetyRatings,
        getModels: carquery.getModels,
        getWikiSummary: carinfo.getWikiSummary,
        getFuelSpecs: carinfo.getFuelSpecs,
        getWikidataFacts: carinfo.getWikidataFacts
      };
      nhtsa.getSafetyRatings = async (make, model) => {
        if (make === 'Isuzu' && model === 'VehiCross') return { overall: 5, frontal: 4, side: null, rollover: 3, year: 2023, ratedAs: 'VEHICROSS 4WD' };
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
        where: { make: 'Isuzu', model: 'Ascender' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, year_max: 2024 }
      });
    });
    after(function() {
      nhtsa.getSafetyRatings = real.getSafetyRatings;
      carquery.getModels = real.getModels;
      carinfo.getWikiSummary = real.getWikiSummary;
      carinfo.getFuelSpecs = real.getFuelSpecs;
      carinfo.getWikidataFacts = real.getWikidataFacts;
    });

    it('shows star ratings on the car detail page, skipping unrated categories', async function() {
      const res = await request(app).get('/cars/car?make=Isuzu&model=VehiCross').expect(200);
      if (!res.text.includes('NHTSA Safety Ratings')) throw new Error('ratings box missing');
      if (!res.text.includes('★★★★★')) throw new Error('overall stars missing');
      if (!res.text.includes('★★★★☆')) throw new Error('frontal stars missing');
      if (!res.text.includes('★★★☆☆')) throw new Error('rollover stars missing');
      if (res.text.includes('Side Crash')) throw new Error('an unrated category should not render');
      if (!res.text.includes('NHTSA Safety Ratings · 2023 model year · rated as VEHICROSS 4WD')) throw new Error('the rated year/name is not shown');
    });

    it('omits the ratings box for a car NHTSA has no rating for', async function() {
      const res = await request(app).get('/cars/car?make=Isuzu&model=Ascender').expect(200);
      if (res.text.includes('NHTSA Safety Ratings')) throw new Error('ratings box should not render');
    });

    it('adds star rating rows to the compare table', async function() {
      const res = await request(app)
        .get('/cars/compare?c=Isuzu|VehiCross&c=Isuzu|Ascender')
        .expect(200);
      if (!res.text.includes('NHTSA Overall')) throw new Error('overall row missing');
      if (!res.text.includes('★★★★★')) throw new Error('VehiCross stars missing from compare');
      // Neither car has a side rating, so that row should be skipped entirely
      if (res.text.includes('NHTSA Side')) throw new Error('a row with no values from either car should not render');
      if (!/Safety rating year<\/th>\s*<td>2023 \(VEHICROSS 4WD\)<\/td>/.test(res.text)) throw new Error('rating year row missing');
    });
  });
});
