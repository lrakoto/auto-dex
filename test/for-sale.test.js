const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { saleLinks } = require('../lib/forSale');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('Find one for sale (R14)', function() {
  describe('lib/forSale.saleLinks', function() {
    it('offers Autotrader and Bring a Trailer searches for cars', function() {
      const links = saleLinks('Mazda', 'MX-5 Miata', 'car');
      assert.deepEqual(links.map(l => l.label), ['Autotrader', 'Bring a Trailer']);
      assert.equal(links[0].url, 'https://www.autotrader.com/cars-for-sale/all-cars?keywordPhrases=Mazda+MX-5+Miata');
      assert.equal(links[1].url, 'https://bringatrailer.com/search/?s=Mazda+MX-5+Miata');
    });

    it('encodes accents and symbols in the query', function() {
      const [, bat] = saleLinks('Citroën', 'C4 & Co', 'car');
      assert.equal(bat.url, 'https://bringatrailer.com/search/?s=Citro%C3%ABn+C4+%26+Co');
    });

    it('offers only Bring a Trailer for motorcycles, and nothing for other types', function() {
      assert.deepEqual(saleLinks('Ducati', 'Monster', 'motorcycle').map(l => l.label), ['Bring a Trailer']);
      assert.deepEqual(saleLinks('Ford', 'F-650', 'commercial'), []);
      assert.deepEqual(saleLinks('Honda', 'TRX450R', 'offroad'), []);
      assert.equal(saleLinks('Honda', 'Civic').length, 2, 'cars by default');
    });
  });

  describe('car detail page', function() {
    let real;
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
      await db.car.findOrCreate({
        where: { make: 'Lotus', model: 'Evora' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car' }
      });
      await db.car.findOrCreate({
        where: { make: 'Isuzu', model: 'FTR Sale Test' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'commercial' }
      });
    });
    after(function() {
      carquery.getModels = real.getModels;
      Object.assign(carinfo, { getWikiSummary: real.getWikiSummary, getFuelSpecs: real.getFuelSpecs, getWikidataFacts: real.getWikidataFacts });
      nhtsa.getSafetyRatings = real.getSafetyRatings;
    });

    it('links to marketplace searches for the car, opening in a new tab without passing ranking', async function() {
      const res = await request(app).get('/cars/car?make=Lotus&model=Evora').expect(200);
      assert.ok(res.text.includes('Find One For Sale'));
      assert.ok(res.text.includes('href="https://bringatrailer.com/search/?s=Lotus+Evora" target="_blank" rel="noopener nofollow"'));
      assert.ok(res.text.includes('keywordPhrases=Lotus+Evora'));
    });

    it('leaves the card out for vehicle types without a checked marketplace', async function() {
      const res = await request(app).get('/cars/car?make=Isuzu&model=FTR%20Sale%20Test&type=commercial').expect(200);
      assert.ok(!res.text.includes('Find One For Sale'));
    });
  });
});
