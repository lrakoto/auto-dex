const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { modelAge, rarityTier, getCarRarity, TIERS } = require('../lib/rarity');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('Rarity (R7)', function() {
  describe('modelAge', function() {
    it('is the whole years since the given year', function() {
      assert.equal(modelAge(1986, new Date('2026-10-30')), 40);
      assert.equal(modelAge(2026, new Date('2026-10-30')), 0);
    });
    it('is 0 with no year', function() {
      assert.equal(modelAge(null), 0);
      assert.equal(modelAge(undefined), 0);
    });
  });

  describe('rarityTier', function() {
    const now = new Date('2026-10-30');

    it('is common for a recent, often-spotted model', function() {
      assert.equal(rarityTier({ year: 2024, spotCount: 10 }, now), 0);
    });

    it('gains a tier for a never-spotted model, and another for an old one', function() {
      assert.equal(rarityTier({ year: 2024, spotCount: 0 }, now), 1);
      assert.equal(rarityTier({ year: 1980, spotCount: 10 }, now), 1);
      assert.equal(rarityTier({ year: 1980, spotCount: 0 }, now), 3);
    });

    it('is capped at legendary even when every factor stacks up', function() {
      assert.equal(rarityTier({ year: 1960, spotCount: 0, unitsBuilt: 5000 }, now), 3);
    });

    it('jumps straight to legendary on a very low production figure, regardless of spots or age', function() {
      assert.equal(rarityTier({ year: 2025, spotCount: 50, unitsBuilt: 50 }, now), 3);
    });

    it('a limited (but not tiny) production figure only pushes up by a point', function() {
      const withoutUnits = rarityTier({ year: 2024, spotCount: 3 }, now);
      const withUnits = rarityTier({ year: 2024, spotCount: 3, unitsBuilt: 5000 }, now);
      assert.equal(withoutUnits, 0);
      assert.equal(withUnits, 1);
    });

    it('a production figure above both thresholds has no effect', function() {
      const withoutUnits = rarityTier({ year: 1960, spotCount: 2 }, now);
      const withHighUnits = rarityTier({ year: 1960, spotCount: 2, unitsBuilt: 500000 }, now);
      assert.equal(withoutUnits, withHighUnits);
    });
  });

  describe('getCarRarity', function() {
    let car;
    before(async function() {
      car = await db.car.create({
        make: 'Panoz', model: 'Esperante GTLM', image: PLACEHOLDER_URL, favcount: 0, updated_img: false,
        vehicle_type: 'car', year_max: 2006
      });
    });

    it('is null with no car', async function() {
      assert.equal(await getCarRarity(null, null), null);
    });

    it('scores a never-spotted, decades-old car as rare or better', async function() {
      const tier = await getCarRarity(car, null);
      assert.ok(tier >= 2, `expected at least rare, got ${TIERS[tier].key}`);
    });

    it('a Wikidata override still only needs the car and a qid', async function() {
      const real = carinfo.getUnitsBuilt;
      carinfo.getUnitsBuilt = async () => 42;
      try {
        assert.equal(await getCarRarity(car, 'Q12345'), 3);
      } finally {
        carinfo.getUnitsBuilt = real;
      }
    });
  });

  describe('the car detail page', function() {
    let real;
    const agent = request.agent(app);

    before(async function() {
      real = {
        getModels: carquery.getModels,
        getWikiSummary: carinfo.getWikiSummary,
        getFuelSpecs: carinfo.getFuelSpecs,
        getWikidataFacts: carinfo.getWikidataFacts,
        getUnitsBuilt: carinfo.getUnitsBuilt,
        getSafetyRatings: nhtsa.getSafetyRatings
      };
      carquery.getModels = async () => [];
      carinfo.getWikiSummary = async () => null;
      carinfo.getFuelSpecs = async () => null;
      carinfo.getWikidataFacts = async () => [];
      carinfo.getUnitsBuilt = async () => null;
      nhtsa.getSafetyRatings = async () => null;
      await db.car.findOrCreate({
        where: { make: 'Isdera', model: 'Commendatore 112i' },
        defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car', year_max: 1960 }
      });
    });
    after(function() {
      Object.assign(carquery, { getModels: real.getModels });
      Object.assign(carinfo, {
        getWikiSummary: real.getWikiSummary, getFuelSpecs: real.getFuelSpecs,
        getWikidataFacts: real.getWikidataFacts, getUnitsBuilt: real.getUnitsBuilt
      });
      nhtsa.getSafetyRatings = real.getSafetyRatings;
    });

    it('shows a rarity badge for a catalog car with no spots on record', async function() {
      const res = await agent.get('/cars/car?make=Isdera&model=Commendatore%20112i').expect(200);
      assert.match(res.text, /rarity-badge rarity-tier-3/);
      assert.match(res.text, />Legendary</);
    });
  });
});
