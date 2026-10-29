const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const { classifyModel, isCommercialName } = require('../lib/vehicleTypes');
const { classifyVehicleTypes, classifyMake, reclassifyAtvs, reclassifyCommercial } = require('../jobs/vehicleTypes');
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

    it('spots incomplete vehicles, medium-duty series, GM cab-overs and Ford E-450 chassis', function() {
      const commercial = [
        ['Buick', 'Incomplete'], ['Chevrolet', 'Bolt Incomplete'], ['Isuzu', '4000 Series Medium Duty'],
        ['Chevrolet', '3500/4500'], ['GMC', 'W3500/W4500'], ['Chevrolet', 'W5500/W5500 HD'], ['Chevrolet', 'FTR / 6500XD'],
        ['Chevrolet', 'T-Series'], ['GMC', 'T Series'], ['Ford', 'E-450'], ['Ford', 'E-550']
      ];
      for (const [make, model] of commercial) {
        if (!isCommercialName(make, model)) throw new Error(`should be commercial: ${make} ${model}`);
      }
      // Pickups and passenger vans stay cars
      const cars = [
        ['Chevrolet', '3500'], ['Chevrolet', '3500HD'], ['Chevrolet', 'Silverado 2500HD'], ['GMC', 'Sierra 3500HD'],
        ['Ram', '3500'], ['Ram', 'ProMaster 3500'], ['Ford', 'E-350'], ['Ford', 'E-150'], ['Ford', 'Escape'],
        ['Chevrolet', 'Tahoe'], ['GMC', 'Terrain'], ['Chevrolet', 'Trax']
      ];
      for (const [make, model] of cars) {
        if (isCommercialName(make, model)) throw new Error(`should stay a car: ${make} ${model}`);
      }
    });

    it('files truck builders the old seeder added as commercial, their SUVs as cars', function() {
      if (classifyModel('Kenworth', 'T680', lists({ truck: ['T680'] })) !== 'commercial') throw new Error('Kenworth');
      if (classifyModel('Kenworth', 'W900', lists({ truck: ['T680'] })) !== 'commercial') throw new Error('Kenworth unlisted');
      if (classifyModel('Fisker', 'Ocean', lists({ mpv: ['Ocean'] })) !== 'car') throw new Error('Fisker');
      if (classifyModel('Buell', '1125R', lists({ motorcycle: ['1125R'] })) !== 'motorcycle') throw new Error('Buell');
    });

    it('files ATVs and side-by-sides NHTSA lists as motorcycles as off-road', function() {
      const kawasaki = lists({ motorcycle: ['Ninja 650', 'MULE 4010', 'Brute Force 750', 'KFX450R'] });
      const got = ['Ninja 650', 'MULE 4010', 'Brute Force 750', 'KFX450R'].map(m => classifyModel('Kawasaki', m, kawasaki));
      if (got.join() !== 'motorcycle,offroad,offroad,offroad') throw new Error(got.join());
      // Unlisted names in a motorcycle-dominated make, too
      if (classifyModel('Honda', 'TRX450R', honda) !== 'offroad') throw new Error('Honda TRX unlisted');
      if (classifyModel('Honda', 'CBR600RR', honda) !== 'motorcycle') throw new Error('Honda bike');
      const yamaha = lists({ motorcycle: ['TRX850'] });
      if (classifyModel('Yamaha', 'TRX850', yamaha) !== 'motorcycle') throw new Error('Yamaha TRX850 road bike');
      if (classifyModel('Yamaha', 'TRX850', lists({})) !== 'motorcycle') throw new Error('retired Yamaha TRX850 road bike');
      // Only ever instead of "motorcycle": a car called Viking stays a car
      if (classifyModel('Ford', 'Viking', lists({ car: ['Viking'] })) !== 'car') throw new Error('car named Viking');
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

    it('adds newly listed ATVs as off-road while keeping road bikes as motorcycles', async function() {
      const previous = { getModels: carquery.getModels, getModelsByType: carquery.getModelsByType };
      const models = ['MULE 4010', 'Ninja 650'];
      carquery.getModelsByType = async (make, type) => type === 'motorcycle' ? models : [];
      carquery.getModels = async (make, { type } = {}) => type === 'motorcycle' ? models.map(model => ({ make, model })) : [];
      try {
        await classifyMake('Kawasaki', { delayMs: 0 });
        const mule = await db.car.findOne({ where: { make: 'Kawasaki', model: 'MULE 4010' } });
        const ninja = await db.car.findOne({ where: { make: 'Kawasaki', model: 'Ninja 650' } });
        if (!mule || mule.vehicle_type !== 'offroad') throw new Error('new ATV should be off-road');
        if (!ninja || ninja.vehicle_type !== 'motorcycle') throw new Error('new road bike should remain a motorcycle');
      } finally {
        Object.assign(carquery, previous);
      }
    });

    it('moves ATVs already typed as motorcycles to off-road, deleting nothing', async function() {
      const rows = await db.car.bulkCreate([
        { make: 'Suzuki', model: 'KingQuad 750AXi', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'motorcycle' },
        { make: 'Suzuki', model: 'LT-Z400', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'motorcycle' },
        { make: 'Suzuki', model: 'Hayabusa', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'motorcycle' },
        { make: 'Honda', model: 'TRX400EX', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'motorcycle' },
        { make: 'Yamaha', model: 'TRX850', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'motorcycle' }
      ], { returning: true });
      const before = await db.car.count();
      await reclassifyAtvs();
      const types = await Promise.all(rows.map(r => r.reload().then(x => x.vehicle_type)));
      if (types.join() !== 'offroad,offroad,motorcycle,offroad,motorcycle') throw new Error(types.join());
      if (await db.car.count() !== before) throw new Error('rows deleted');
      if (await reclassifyAtvs() !== 0) throw new Error('second pass changed rows');
    });

    it('repairs typed ATVs even when the upkeep finds no untyped makes', async function() {
      const atv = await db.car.create({
        make: 'Honda', model: 'TRX300EX', image: 'https://example.com/trx.jpg',
        favcount: 4, updated_img: true, vehicle_type: 'motorcycle'
      });
      const previous = db.car.findAll;
      db.car.findAll = function(options) {
        if (options.where && options.where.vehicle_type === null) return Promise.resolve([]);
        return previous.call(this, options);
      };
      try {
        await classifyVehicleTypes({ delayMs: 0 });
        await atv.reload();
        if (atv.vehicle_type !== 'offroad') throw new Error('upkeep skipped the ATV repair');
        if (atv.image !== 'https://example.com/trx.jpg' || atv.favcount !== 4 || !atv.updated_img) {
          throw new Error('repair changed unrelated car data');
        }
      } finally {
        db.car.findAll = previous;
      }
    });

    it('moves chassis already typed as cars to commercial, deleting nothing', async function() {
      const rows = await db.car.bulkCreate([
        { make: 'Ford', model: 'E-450', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car' },
        { make: 'GMC', model: 'W3500/W4500', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car' },
        { make: 'Ford', model: 'E-350', image: PLACEHOLDER_URL, favcount: 0, updated_img: false, vehicle_type: 'car' }
      ], { returning: true });
      const before = await db.car.count();
      await reclassifyCommercial();
      const types = await Promise.all(rows.map(r => r.reload().then(x => x.vehicle_type)));
      if (types.join() !== 'commercial,commercial,car') throw new Error(types.join());
      if (await db.car.count() !== before) throw new Error('rows deleted');
      if (await reclassifyCommercial() !== 0) throw new Error('second pass changed rows');
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
