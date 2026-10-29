const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const { PLACEHOLDER_URL } = require('../lib/constants');

// FuelEconomy.gov and NHTSA's crash ratings only cover passenger vehicles
describe('Passenger-only lookups', function() {
  let real;
  const asked = { fuel: [], safety: [], complaints: [] };

  before(async function() {
    real = {
      getModels: carquery.getModels,
      getWikiSummary: carinfo.getWikiSummary,
      getWikidataFacts: carinfo.getWikidataFacts,
      getFuelSpecs: carinfo.getFuelSpecs,
      getSafetyRatings: nhtsa.getSafetyRatings,
      getComplaints: nhtsa.getComplaints
    };
    carquery.getModels = async () => [];
    carinfo.getWikiSummary = async () => null;
    carinfo.getWikidataFacts = async () => [];
    carinfo.getFuelSpecs = async (make, model) => { asked.fuel.push(model); return null; };
    nhtsa.getSafetyRatings = async (make, model) => { asked.safety.push(model); return null; };
    nhtsa.getComplaints = async (make, model) => { asked.complaints.push(model); return null; };
    const row = (make, model, vehicleType) => db.car.findOrCreate({
      where: { make, model },
      defaults: { image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: vehicleType, year_max: 2024 }
    });
    await row('Lotus', 'Lookup Elise', 'car');
    await row('Ducati', 'Lookup Monster', 'motorcycle');
    await row('Honda', 'Lookup Pioneer', 'offroad');
  });
  after(function() {
    carquery.getModels = real.getModels;
    Object.assign(carinfo, { getWikiSummary: real.getWikiSummary, getWikidataFacts: real.getWikidataFacts, getFuelSpecs: real.getFuelSpecs });
    Object.assign(nhtsa, { getSafetyRatings: real.getSafetyRatings, getComplaints: real.getComplaints });
  });
  beforeEach(function() { for (const k of Object.keys(asked)) asked[k].length = 0; });

  it('skips fuel and crash-rating lookups on a motorcycle or off-road page, keeps complaints', async function() {
    await request(app).get('/cars/car?make=Ducati&model=Lookup%20Monster&type=motorcycle').expect(200);
    await request(app).get('/cars/car?make=Honda&model=Lookup%20Pioneer&type=offroad').expect(200);
    assert.deepEqual(asked.fuel, []);
    assert.deepEqual(asked.safety, []);
    assert.deepEqual(asked.complaints.sort(), ['Lookup Monster', 'Lookup Pioneer']);
  });

  it('still asks for a car', async function() {
    await request(app).get('/cars/car?make=Lotus&model=Lookup%20Elise').expect(200);
    assert.deepEqual(asked.fuel, ['Lookup Elise']);
    assert.deepEqual(asked.safety, ['Lookup Elise']);
  });

  it('does the same per vehicle on the compare page', async function() {
    await request(app).get('/cars/compare?c=Lotus|Lookup%20Elise&c=Ducati|Lookup%20Monster').expect(200);
    assert.deepEqual(asked.fuel, ['Lookup Elise']);
    assert.deepEqual(asked.safety, ['Lookup Elise']);
  });
});
