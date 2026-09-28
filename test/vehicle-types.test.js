const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const { classifyModel, isCommercialName } = require('../lib/vehicleTypes');
const { classifyMake } = require('../jobs/vehicleTypes');
const { photoPoolWhere } = require('../lib/catalog');
const { createVerifiedUser } = require('./helpers');
const { PLACEHOLDER_URL } = require('../lib/constants');

const NHTSA_TYPES = [...new Set(Object.values(carquery.VEHICLE_TYPES).flatMap(t => t.nhtsa))];

// NHTSA lists for one make: { car: [...], motorcycle: [...] } → Sets for every type
function lists(byType) {
  const out = {};
  for (const t of NHTSA_TYPES) out[t] = new Set((byType[t] || []).map(s => s.toLowerCase()));
  return out;
}

describe('Vehicle types', function() {
  describe('classifier', function() {
    const bikes = Array.from({ length: 20 }, (_, i) => `CB${i}00`);
    const honda = lists({
      car: ['Civic', 'Accord'], mpv: ['CR-V', 'Odyssey'], truck: ['Ridgeline'],
      motorcycle: ['Gold Wing', ...bikes], 'off road vehicle': ['Pioneer 1000']
    });

    it('sorts listed models into cars, motorcycles and off-road', function() {
      const got = ['Civic', 'CR-V', 'Ridgeline', 'Gold Wing', 'Pioneer 1000'].map(m => classifyModel('Honda', m, honda));
      if (got.join() !== 'car,car,car,motorcycle,offroad') throw new Error(got.join());
    });

    it('treats names NHTSA dropped by what the make mostly builds', function() {
      // Honda is motorcycle-dominated: an unlisted name is a renamed bike
      if (classifyModel('Honda', 'C125 (Super Cub)', honda) !== 'motorcycle') throw new Error('Honda unlisted');
      // Polestar builds cars: "PS2" is a renamed car
      const polestar = lists({ car: ['Polestar 2'], mpv: ['Polestar 3'] });
      if (classifyModel('Polestar', 'PS2', polestar) !== 'car') throw new Error('Polestar unlisted');
      // A motorcycle brand is always bikes
      if (classifyModel('Ducati', 'Paso', lists({})) !== 'motorcycle') throw new Error('Ducati unlisted');
    });

    it('keeps pickups with cars but files heavy trucks and chassis as commercial', function() {
      const ford = lists({ truck: ['F-150', 'F-650', 'L8501'], mpv: ['L8501'], 'incomplete vehicle': ['Commercial Chassis'] });
      const got = ['F-150', 'F-550', 'F-650', 'L8501', 'Commercial Chassis'].map(m => classifyModel('Ford', m, ford));
      if (got.join() !== 'car,car,commercial,commercial,commercial') throw new Error(got.join());
      const gm = lists({ truck: ['C1500', 'C4500', '3500HD', '4500HD'] });
      const gmGot = ['C1500', 'C4500', '3500HD', '4500HD'].map(m => classifyModel('Chevrolet', m, gm));
      if (gmGot.join() !== 'car,commercial,car,commercial') throw new Error(gmGot.join());
      if (classifyModel('Volvo', 'B12B', lists({ bus: ['B12B'] })) !== 'commercial') throw new Error('bus');
      if (!isCommercialName('Chevrolet', 'Express Cutaway') || isCommercialName('Ford', 'Transit')) throw new Error('names');
      if (classifyModel('GMC', 'Typhoon', lists({ 'incomplete vehicle': ['Typhoon'] })) !== 'car') throw new Error('override');
    });

    it('files truck builders the old seeder added as commercial, their SUVs as cars', function() {
      if (classifyModel('Kenworth', 'T680', lists({ truck: ['T680'] })) !== 'commercial') throw new Error('Kenworth');
      if (classifyModel('Kenworth', 'W900', lists({ truck: ['T680'] })) !== 'commercial') throw new Error('Kenworth unlisted');
      if (classifyModel('Fisker', 'Ocean', lists({ mpv: ['Ocean'] })) !== 'car') throw new Error('Fisker');
      if (classifyModel('Buell', '1125R', lists({ motorcycle: ['1125R'] })) !== 'motorcycle') throw new Error('Buell');
    });
  });

  // Shared fixtures for the job and the pages: BMW builds cars and bikes
  describe('catalog', function() {
    const real = {};
    const nhtsa = { car: ['M3'], mpv: ['X5'], motorcycle: ['R 1250 GS', 'S 1000 RR'] };
    const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

    before(async function() {
      Object.assign(real, {
        getModelsByType: carquery.getModelsByType,
        getModels: carquery.getModels,
        getWikiSummary: carinfo.getWikiSummary,
        getFuelSpecs: carinfo.getFuelSpecs,
        getWikidataFacts: carinfo.getWikidataFacts
      });
      carquery.getModelsByType = async (make, type) => (make === 'BMW' ? nhtsa[type] || [] : []);
      carquery.getModels = async (make, { type = 'car' } = {}) => {
        if (make !== 'BMW') return [];
        const names = type === 'car' ? [...nhtsa.car, ...nhtsa.mpv] : (type === 'motorcycle' ? nhtsa.motorcycle : []);
        return names.map(model => ({ make, model }));
      };
      carinfo.getWikiSummary = async () => null;
      carinfo.getFuelSpecs = async () => null;
      carinfo.getWikidataFacts = async () => [];

      await db.car.bulkCreate([
        { make: 'BMW', model: 'M3', image: 'https://example.com/m3.jpg', favcount: 0, updated_img: true },
        { make: 'BMW', model: 'R 1250 GS', image: 'https://example.com/gs.jpg', favcount: 0, updated_img: true,
          model_years: span(2019, 2025), year_min: 2019, year_max: 2025, years_checked: true },
        { make: 'Ducati', model: 'Panigale V4', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'motorcycle' }
      ]);
    });
    after(function() {
      Object.assign(carquery, { getModelsByType: real.getModelsByType, getModels: real.getModels });
      Object.assign(carinfo, { getWikiSummary: real.getWikiSummary, getFuelSpecs: real.getFuelSpecs, getWikidataFacts: real.getWikidataFacts });
    });

    it('classifies a make and adds the listed models it lacked, deleting nothing', async function() {
      const before = await db.car.count();
      const result = await classifyMake('BMW', { delayMs: 0 });
      const rows = await db.car.findAll({ where: { make: 'BMW' }, order: [['model', 'ASC']] });
      const got = rows.map(r => `${r.model}=${r.vehicle_type}`).join(', ');
      if (got !== 'M3=car, R 1250 GS=motorcycle, S 1000 RR=motorcycle, X5=car') throw new Error(got);
      if (result.classified !== 2 || result.added !== 2) throw new Error(JSON.stringify(result));
      if (await db.car.count() !== before + 2) throw new Error('rows were removed');
    });

    it('leaves a make untyped when one of its NHTSA lists fails', async function() {
      await db.car.create({ make: 'BMW', model: 'Isetta', image: PLACEHOLDER_URL, favcount: 0, updated_img: false });
      const stub = carquery.getModelsByType;
      carquery.getModelsByType = async (make, type) => { if (type === 'bus') throw new Error('NHTSA down'); return stub(make, type); };
      let failed = false;
      try { await classifyMake('BMW', { delayMs: 0 }); } catch (e) { failed = true; }
      carquery.getModelsByType = stub;
      const isetta = await db.car.findOne({ where: { make: 'BMW', model: 'Isetta' } });
      if (!failed || isetta.vehicle_type !== null) throw new Error('classified from partial lists');
    });

    it('gives a make with both kinds a tab for each', async function() {
      const cars = await request(app).get('/cars?selectmake=BMW').expect(200);
      if (!/class="type-tab active"[^>]*>\s*Cars/.test(cars.text) || !cars.text.includes('&amp;type=motorcycle')) throw new Error('tabs missing');
      const bikes = await request(app).get('/cars?selectmake=BMW&type=motorcycle').expect(200);
      if (!bikes.text.includes('>R 1250 GS<') || bikes.text.includes('>M3<')) throw new Error('motorcycle tab lists the wrong models');
      if (!/<title>BMW Motorcycles/.test(bikes.text)) throw new Error('title');
      if (!/rel="canonical" href="[^"]*selectmake=BMW&amp;type=motorcycle"/.test(bikes.text)) throw new Error('canonical');
    });

    it('opens a motorcycle brand on its motorcycles', async function() {
      const res = await request(app).get('/cars?selectmake=Ducati').expect(200);
      if (!/<title>Ducati Motorcycles/.test(res.text) || !res.text.includes('>Panigale V4<')) throw new Error('Ducati page');
    });

    it('shelves the makes page by kind', async function() {
      const res = await request(app).get('/makes').expect(200);
      const bikesShelf = res.text.slice(res.text.indexOf('id="motorcycles"'));
      if (!bikesShelf.includes('/cars?selectmake=BMW&amp;type=motorcycle') || !bikesShelf.includes('/cars?selectmake=Ducati&amp;type=motorcycle')) {
        throw new Error('motorcycle shelf missing makes');
      }
    });

    it('explores cars by default, motorcycles on request, and marks types when mixed', async function() {
      let res = await request(app).get('/cars/explore?make=BMW').expect(200);
      if (!res.text.includes('>M3<') || res.text.includes('>R 1250 GS<')) throw new Error('default should be cars');
      res = await request(app).get('/cars/explore?make=BMW&type=motorcycle').expect(200);
      if (res.text.includes('>M3<') || !res.text.includes('>R 1250 GS<')) throw new Error('motorcycle filter');
      res = await request(app).get('/cars/explore?make=BMW&type=all').expect(200);
      if (!res.text.includes('>M3<') || !/card-badge--type">Motorcycle</.test(res.text)) throw new Error('all + badge');
    });

    it('labels a motorcycle page and links back to the motorcycles', async function() {
      const res = await request(app).get('/cars/car?make=BMW&model=R%201250%20GS').expect(200);
      if (!/class="car-hero-sub">Motorcycle · Germany · 2019–2025</.test(res.text)) throw new Error('hero sub');
      if (!res.text.includes('href="/cars?selectmake=BMW&amp;type=motorcycle"')) throw new Error('back link');
      const timeline = await request(app).get('/cars/timeline?make=BMW&type=motorcycle').expect(200);
      if (!/<h1 class="jumbotron-heading">BMW Motorcycle Timeline/.test(timeline.text) || !timeline.text.includes('>R 1250 GS<')) {
        throw new Error('motorcycle timeline');
      }
    });

    it('keeps motorcycles out of the car quiz and Car of the Day', async function() {
      const pool = await db.car.findAll({ attributes: ['model'], where: photoPoolWhere({ makes: ['BMW'] }) });
      if (pool.map(c => c.model).join() !== 'M3') throw new Error('pool: ' + pool.map(c => c.model).join());
    });

    it('offers cars and motorcycles when adding to a garage', async function() {
      const agent = request.agent(app);
      await createVerifiedUser(agent, db, { email: 'two-wheels@example.com' });
      const res = await agent.get('/garage/models?make=BMW').expect(200);
      const labels = res.body.groups.map(g => `${g.label}:${g.models.length}`).join();
      if (labels !== 'Cars:2,Motorcycles:2') throw new Error(labels);
    });
  });
});
