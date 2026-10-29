const assert = require('node:assert/strict');
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

    it('picks a drivetrain/trim variant only when it starts with every word of the model', function() {
      const names = ['Ascent', 'Outback Wilderness AWD', 'Outback AWD', 'CX-50 4WD', 'CX-5 4WD', 'F150 Pickup 2WD', 'F150 Pickup 4WD', 'Civic', 'Civic Type R'];
      assert.equal(carinfo.fuelVariant(names, 'Outback'), 'Outback AWD', 'fewest extra words');
      assert.equal(carinfo.fuelVariant(names, 'CX-5'), 'CX-5 4WD', 'not the CX-50');
      assert.equal(carinfo.fuelVariant(names, 'F-150'), 'F150 Pickup 2WD', 'hyphens ignored; ties alphabetical');
      assert.equal(carinfo.fuelVariant(names, 'Civic Type R'), null, 'an exact name is not a variant');
      assert.equal(carinfo.fuelVariant(names, 'MX-5 Miata'), null, 'never a shorter name');
      assert.equal(carinfo.fuelVariant([], 'Outback'), null);
    });

    it('falls back to a variant when FuelEconomy.gov answers the exact name with null', async function() {
      const asked = [];
      axios.get = async (url, { params } = {}) => {
        asked.push(params && params.model);
        if (url.includes('/menu/options')) {
          // The service answers names it doesn't know with a JSON null
          return { data: params.model === 'Telluride AWD' && params.year === 2025 ? { menuItem: { value: 'telluride-awd' } } : null };
        }
        if (url.includes('/menu/model')) {
          return { data: params.year === 2025 ? { menuItem: [{ value: 'Sorento' }, { value: 'Telluride FWD' }, { value: 'Telluride AWD' }] } : null };
        }
        return { data: { year: 2025, drive: 'All-Wheel Drive', fuelCost08: 3200 } };
      };
      const specs = await carinfo.getFuelSpecs('Kia', 'Telluride', 2025);
      assert.ok(specs, 'expected specs from the variant');
      assert.equal(specs.annualFuelCost, 3200);
      assert.ok(asked.includes('Telluride AWD'), 'asked for the variant');
    });

    it('returns null, without throwing, when neither the name nor a variant exists', async function() {
      axios.get = async url => ({ data: url.includes('/menu/model') ? { menuItem: { value: 'Something Else' } } : null });
      assert.equal(await carinfo.getFuelSpecs('Dacia', 'Duster', 2025), null);
    });

    it('reports overspend as a negative fiveYearSavings, left for callers to format', async function() {
      axios.get = async url => {
        if (url.includes('/menu/options')) return { data: { menuItem: { value: '1' } } };
        return { data: { year: 2024, fuelCost08: 3000, youSaveSpend: -1800 } };
      };
      const specs = await carinfo.getFuelSpecs('Ford', 'F-150', 2024);
      if (specs.fiveYearSavings !== -1800) throw new Error('expected negative savings, got ' + specs.fiveYearSavings);
    });

    it('normalizes numeric strings while preserving zero and signed savings', async function() {
      axios.get = async url => url.includes('/menu/options')
        ? { data: { menuItem: { value: 'r6-numeric-strings' } } }
        : { data: { year: 2024, fuelCost08: '0', youSaveSpend: '-1', co2TailpipeGpm: '0', feScore: '10', ghgScore: '1' } };
      const specs = await carinfo.getFuelSpecs('Fixture', 'Numeric strings', 2024);
      assert.deepEqual([specs.annualFuelCost, specs.fiveYearSavings, specs.co2, specs.feScore, specs.ghgScore], [0, -1, 0, 10, 1]);
    });

    it('rejects blank, nonnumeric and nonfinite values instead of inventing zero', async function() {
      const values = [null, undefined, '', '  ', true, false, {}, [], 'unknown', Infinity, -Infinity, NaN];
      for (const [i, value] of values.entries()) {
        axios.get = async url => url.includes('/menu/options')
          ? { data: { menuItem: { value: `r6-invalid-${i}` } } }
          : { data: { fuelCost08: value, youSaveSpend: value, co2TailpipeGpm: value, feScore: value, ghgScore: value } };
        const specs = await carinfo.getFuelSpecs('Fixture', `Invalid ${i}`, 2024);
        assert.deepEqual([specs.annualFuelCost, specs.fiveYearSavings, specs.co2, specs.feScore, specs.ghgScore], [null, null, null, null, null]);
      }
    });

    it('hides negative costs/emissions and unavailable or out-of-range scores, keeping negative savings', async function() {
      for (const [i, score] of [-1, 0, 11, 7.5].entries()) {
        axios.get = async url => url.includes('/menu/options')
          ? { data: { menuItem: { value: `r6-sentinel-${i}` } } }
          : { data: { fuelCost08: -1, youSaveSpend: -1, co2TailpipeGpm: -1, feScore: score, ghgScore: score } };
        const specs = await carinfo.getFuelSpecs('Fixture', `Sentinel ${i}`, 2024);
        assert.deepEqual([specs.annualFuelCost, specs.fiveYearSavings, specs.co2, specs.feScore, specs.ghgScore], [null, -1, null, null, null]);
      }
    });
  });

  describe('detail and compare pages', function() {
    let real, fixtureSpecs;

    beforeEach(function() { fixtureSpecs = null; });

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
        if (fixtureSpecs) return fixtureSpecs;
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
      if (!res.text.includes('Tailpipe CO₂')) throw new Error('CO2 row missing');
      if (!res.text.includes('EPA Fuel Economy Score')) throw new Error('fe score row missing');
      if (!res.text.includes('EPA GHG Score')) throw new Error('ghg score row missing');
    });

    const pages = ['/cars/car?make=Honda&model=Civic', '/cars/compare?c=Honda|Civic&c=Ford|F-150'];
    it('shows zero costs/emissions, neutral savings and the estimate assumptions on both pages', async function() {
      fixtureSpecs = { year: 2024, annualFuelCost: 0, fiveYearSavings: 0, co2: 0, feScore: 10, ghgScore: 10 };
      for (const url of pages) {
        const res = await request(app).get(url).expect(200);
        for (const text of ['$0', 'Same as average', '0 g/mi', '10/10', '15,000 miles/year', '55% city', 'one available configuration', 'average new vehicle', 'tailpipe only', 'higher is better']) {
          assert.ok(res.text.includes(text), `missing ${text} on ${url}`);
        }
      }
    });

    it('omits unavailable estimate rows and their note', async function() {
      fixtureSpecs = { year: 2024, annualFuelCost: null, fiveYearSavings: null, co2: null, feScore: null, ghgScore: null };
      for (const url of pages) {
        const res = await request(app).get(url).expect(200);
        for (const text of ['Annual Fuel Cost', '5-Yr vs Avg New Vehicle', 'Tailpipe CO₂', 'EPA Fuel Economy Score', 'EPA GHG Score', '15,000 miles/year']) {
          assert.ok(!res.text.includes(text), `unavailable ${text} shown on ${url}`);
        }
      }
    });

    it('shows minus-one savings as spending, not as an unavailable sentinel', async function() {
      fixtureSpecs = { year: 2024, fiveYearSavings: -1 };
      for (const url of pages) {
        const res = await request(app).get(url).expect(200);
        assert.ok(res.text.includes('Spend $1'));
      }
    });
  });
});
