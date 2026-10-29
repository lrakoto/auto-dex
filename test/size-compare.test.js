const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { sizeComparison, formatDims, PAD_MM } = require('../lib/sizes');
const { PLACEHOLDER_URL } = require('../lib/constants');

// A Wikidata quantity claim: amount in the given unit item
const quantity = (amount, unit) => [{ mainsnak: { datavalue: { value: { amount: `+${amount}`, unit: `http://www.wikidata.org/entity/${unit}` } } } }];
const MM = 'Q174789';

describe('Size comparison (R11)', function() {
  describe('millimetres on Wikidata dimension facts', function() {
    it('converts mm, cm, m, inches and feet, and keeps the printed text', function() {
      const facts = carinfo.extractFacts({
        claims: { P2043: quantity(4694, MM), P2049: quantity(2.088, 'Q11573'), P2048: quantity(56.5, 'Q218593') }
      }, {});
      const byLabel = Object.fromEntries(facts.map(f => [f.label, f]));
      assert.equal(byLabel.Length.mm, 4694);
      assert.equal(byLabel.Width.mm, 2088);
      assert.equal(byLabel.Height.mm, 1435); // 56.5 in
      assert.deepEqual(byLabel.Width.values, ['2.088 m']);

      const feet = carinfo.extractFacts({ claims: { P2043: quantity(15, 'Q3710') } }, {});
      assert.equal(feet[0].mm, 4572);
      const cm = carinfo.extractFacts({ claims: { P2048: quantity(143.6, 'Q174728') } }, {});
      assert.equal(cm[0].mm, 1436);
    });

    it('leaves implausible sizes and non-dimension facts out of the drawing', function() {
      const facts = carinfo.extractFacts({
        claims: { P2043: quantity(4.694, MM), P2067: quantity(1600, 'Q11570'), P2049: quantity(2088, 'Q999') }
      }, {});
      const byLabel = Object.fromEntries(facts.map(f => [f.label, f]));
      assert.equal(byLabel.Length.mm, undefined, 'a length in metres tagged as mm must not be drawn');
      assert.deepEqual(byLabel.Length.values, ['4.694 mm'], 'the printed fact still shows');
      assert.equal(byLabel.Weight.mm, undefined);
      assert.equal(byLabel.Width, undefined, 'unknown units stay unprinted, as before');
    });
  });

  describe('lib/sizes', function() {
    const model3 = { make: 'Tesla', model: 'Model 3', dims: { length: 4694, width: 2088, height: 1436 } };
    const fiat = { make: 'Fiat', model: '500', dims: { length: 2970, width: 1320, height: 1325 } };

    it('returns null when no car can be drawn', function() {
      assert.equal(sizeComparison([]), null);
      assert.equal(sizeComparison([{ make: 'A', model: 'B', dims: { length: 4000, width: null, height: null } }]), null);
    });

    it('stands every car on one ground line, side views left-aligned and front views centred', function() {
      const size = sizeComparison([fiat, model3]);
      assert.equal(size.side.ground, size.front.ground);
      assert.equal(size.side.height, size.front.height, 'shared height = shared scale');
      assert.equal(size.side.width, 4694 + 2 * PAD_MM);
      assert.equal(size.front.width, 2088 + 2 * PAD_MM);
      for (const c of size.side.cars) {
        assert.equal(c.x, PAD_MM);
        assert.equal(c.y + c.h, size.side.ground);
      }
      const centres = size.front.cars.map(c => c.x + c.w / 2);
      assert.equal(centres[0], centres[1]);
      // Biggest first, so the smaller outline is painted on top
      assert.deepEqual(size.side.cars.map(c => c.index), [1, 0]);
    });

    it('draws a car in whichever view its dimensions allow and labels the rest', function() {
      const noWidth = { make: 'Chrysler', model: 'Prowler', dims: { length: 4199, width: null, height: 1293 } };
      const none = { make: 'Lancia', model: 'Flavia', dims: { length: null, width: null, height: null } };
      const size = sizeComparison([model3, noWidth, none]);
      assert.deepEqual(size.side.cars.map(c => c.index).sort(), [0, 1]);
      assert.deepEqual(size.front.cars.map(c => c.index), [0]);
      assert.deepEqual(size.legend.map(e => e.drawn), [true, true, false]);
      assert.equal(formatDims(size.legend[1]), '4,199 × ? × 1,293 mm');
    });
  });

  describe('compare page', function() {
    let real;
    const dims = {
      Q1: { Length: 4694, Width: 2088, Height: 1436 },
      Q2: { Length: 2970, Width: 1320, Height: 1325 }
    };

    before(async function() {
      real = {
        getModels: carquery.getModels,
        getWikiSummary: carinfo.getWikiSummary,
        getFuelSpecs: carinfo.getFuelSpecs,
        getWikidataFacts: carinfo.getWikidataFacts,
        getSafetyRatings: nhtsa.getSafetyRatings
      };
      carquery.getModels = async () => [];
      carinfo.getFuelSpecs = async () => null;
      nhtsa.getSafetyRatings = async () => null;
      const qids = { 'Tesla Model 3': 'Q1', 'Fiat 500': 'Q2', 'Lancia Flavia': 'Q3' };
      carinfo.getWikiSummary = async (make, model) => ({ wikidataId: qids[`${make} ${model}`] || null });
      carinfo.getWikidataFacts = async qid => Object.entries(dims[qid] || {})
        .map(([label, mm]) => ({ label, values: [`${mm.toLocaleString('en-US')} mm`], mm }));
      for (const [make, model] of [['Tesla', 'Model 3'], ['Fiat', '500'], ['Lancia', 'Flavia']]) {
        await db.car.findOrCreate({
          where: { make, model },
          defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false }
        });
      }
    });
    after(function() { Object.assign(carinfo, { getWikiSummary: real.getWikiSummary, getFuelSpecs: real.getFuelSpecs, getWikidataFacts: real.getWikidataFacts }); carquery.getModels = real.getModels; nhtsa.getSafetyRatings = real.getSafetyRatings; });

    it('draws side and front views to scale with a legend', async function() {
      const res = await request(app).get('/cars/compare?c=Tesla|Model%203&c=Fiat|500&c=Lancia|Flavia').expect(200);
      assert.ok(res.text.includes('id="size-heading"'), 'size section missing');
      assert.match(res.text, /aria-label="Side view to scale: Tesla Model 3 4,694 mm long, 1,436 mm tall; Fiat 500 2,970 mm long/);
      assert.match(res.text, /aria-label="Front view to scale: Tesla Model 3 2,088 mm wide/);
      assert.equal((res.text.match(/<rect class="size-car /g) || []).length, 4, 'two cars in two views');
      assert.ok(res.text.includes('4,694 × 2,088 × 1,436 mm'));
      assert.ok(res.text.includes('No size data on Wikidata'), 'the car without data is labelled');
    });

    it('leaves the section out when no compared car has dimensions', async function() {
      const res = await request(app).get('/cars/compare?c=Lancia|Flavia').expect(200);
      assert.ok(!res.text.includes('id="size-heading"'));
    });
  });
});
