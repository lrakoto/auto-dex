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
      if (asked.length !== 2 || !asked[0].includes('/modelyear/2024/make/Mazda/model/MX-5%20Miata')) {
        throw new Error('wrong lookup URLs: ' + asked.join(' '));
      }
      if (!asked[1].endsWith('/SafetyRatings/VehicleId/12345')) throw new Error('vehicle id not used: ' + asked[1]);
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
        if (make === 'Isuzu' && model === 'VehiCross') return { overall: 5, frontal: 4, side: null, rollover: 3 };
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
    });
  });
});
