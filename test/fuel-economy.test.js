const request = require('supertest');
const axios = require('axios');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { cacheClear } = require('../lib/cache');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('FuelEconomy.gov running-cost specs', function() {
  describe('lib/carinfo.getFuelSpecs', function() {
    let realGet;
    beforeEach(function() {
      realGet = axios.get;
      cacheClear();
    });
    afterEach(function() { axios.get = realGet; });

    it('includes annual fuel cost, 5-year savings, CO2 and EPA scores', async function() {
      axios.get = async url => {
        if (url.includes('/menu/options')) return { data: { menuItem: { value: '9999' } } };
        return {
          data: {
            year: 2024, VClass: 'Compact Cars', city08: 32, highway08: 42, comb08: 36,
            fuelCost08: 1500, youSaveSpend: 2250, co2TailpipeGpm: 250, feScore: 7, ghgScore: 7
          }
        };
      };
      const specs = await carinfo.getFuelSpecs('Honda', 'Civic', 2024);
      if (!specs) throw new Error('expected specs');
      if (specs.annualFuelCost !== 1500) throw new Error('annualFuelCost wrong: ' + specs.annualFuelCost);
      if (specs.fiveYearSavings !== 2250) throw new Error('fiveYearSavings wrong: ' + specs.fiveYearSavings);
      if (specs.co2 !== 250) throw new Error('co2 wrong: ' + specs.co2);
      if (specs.feScore !== 7) throw new Error('feScore wrong: ' + specs.feScore);
      if (specs.ghgScore !== 7) throw new Error('ghgScore wrong: ' + specs.ghgScore);
    });

    it('reports overspend as a negative fiveYearSavings, left for callers to format', async function() {
      axios.get = async url => {
        if (url.includes('/menu/options')) return { data: { menuItem: { value: '1' } } };
        return { data: { year: 2024, fuelCost08: 3000, youSaveSpend: -1800 } };
      };
      const specs = await carinfo.getFuelSpecs('Ford', 'F-150', 2024);
      if (specs.fiveYearSavings !== -1800) throw new Error('expected negative savings, got ' + specs.fiveYearSavings);
    });
  });

  describe('detail and compare pages', function() {
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
      carinfo.getWikidataFacts = async () => [];
      nhtsa.getSafetyRatings = async () => null;
      carinfo.getFuelSpecs = async (make, model) => {
        if (make === 'Honda' && model === 'Civic') {
          return { year: 2024, annualFuelCost: 1500, fiveYearSavings: 2250, co2: 250, feScore: 7, ghgScore: 7 };
        }
        if (make === 'Ford' && model === 'F-150') {
          return { year: 2024, annualFuelCost: 3000, fiveYearSavings: -1800, co2: 450, feScore: 3, ghgScore: 3 };
        }
        return null;
      };
      await db.car.findOrCreate({
        where: { make: 'Honda', model: 'Civic' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, year_max: 2024 }
      });
      await db.car.findOrCreate({
        where: { make: 'Ford', model: 'F-150' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, year_max: 2024 }
      });
    });
    after(function() {
      carquery.getModels = real.getModels;
      carinfo.getWikiSummary = real.getWikiSummary;
      carinfo.getFuelSpecs = real.getFuelSpecs;
      carinfo.getWikidataFacts = real.getWikidataFacts;
      nhtsa.getSafetyRatings = real.getSafetyRatings;
    });

    it('shows annual fuel cost, savings, CO2 and EPA scores on the car detail page', async function() {
      const res = await request(app).get('/cars/car?make=Honda&model=Civic').expect(200);
      if (!res.text.includes('Annual Fuel Cost')) throw new Error('fuel cost missing');
      if (!res.text.includes('$1,500')) throw new Error('fuel cost value missing');
      if (!res.text.includes('Save $2,250')) throw new Error('savings missing');
      if (!res.text.includes('250 g/mi')) throw new Error('co2 missing');
      if (!res.text.includes('EPA Fuel Economy Score')) throw new Error('fe score missing');
      if (!res.text.includes('EPA GHG Score')) throw new Error('ghg score missing');
    });

    it('shows an overspend as "Spend $" on the detail page', async function() {
      const res = await request(app).get('/cars/car?make=Ford&model=F-150').expect(200);
      if (!res.text.includes('Spend $1,800')) throw new Error('overspend missing: ' + res.text.includes('5-Yr'));
    });

    it('adds fuel cost, savings, CO2 and EPA score rows to the compare table', async function() {
      const res = await request(app)
        .get('/cars/compare?c=Honda|Civic&c=Ford|F-150')
        .expect(200);
      if (!res.text.includes('Annual Fuel Cost')) throw new Error('fuel cost row missing');
      if (!res.text.includes('$1,500')) throw new Error('Civic fuel cost missing');
      if (!res.text.includes('$3,000')) throw new Error('F-150 fuel cost missing');
      if (!res.text.includes('Save $2,250')) throw new Error('Civic savings missing');
      if (!res.text.includes('Spend $1,800')) throw new Error('F-150 overspend missing');
      if (!res.text.includes('CO₂ (g/mi)')) throw new Error('CO2 row missing');
      if (!res.text.includes('EPA Fuel Economy Score')) throw new Error('fe score row missing');
      if (!res.text.includes('EPA GHG Score')) throw new Error('ghg score row missing');
    });
  });
});
