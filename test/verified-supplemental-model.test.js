const assert = require('node:assert/strict');
const axios = require('axios');
const carquery = require('../config/carquery');
const db = require('../models');
const { cacheClear } = require('../lib/cache');
const { findOrCreateCatalogCar, lookupCatalogCar } = require('../lib/catalog');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('Verified supplemental catalog models', function() {
  it('keeps canonical spelling in healthy and partial lists without obscuring empty results', async function() {
    // Separate spellings of the same make keep cache records independent.
    const fixtures = {
      BmW: { car: ['528xi', '528I XDRIVE'], mpv: ['X5'], truck: [] },
      bMw: { car: ['528i'], mpv: null, truck: [] },
      bmW: { car: [], mpv: [], truck: [] },
      bMW: { car: null, mpv: null, truck: null }
    };
    const original = axios.get;
    const keys = new Set();
    cacheClear();
    carquery.clearModelsCache();
    axios.get = async url => {
      keys.add(url);
      const [, make, type] = url.match(/\/make\/([^/]+)\/vehicletype\/([^?]+)/);
      const models = fixtures[make][type];
      if (models === null) throw new Error('Simulated vPIC outage');
      return { data: { Results: models.map(Model_Name => ({ Make_Name: 'BMW', Model_Name })) } };
    };
    const names = async make => (await carquery.getModels(make)).map(model => model.model);
    try {
      assert.deepEqual(await names('BmW'), ['528i xDrive', '528xi', 'X5']);
      assert.deepEqual(await names('bMw'), ['528i', '528i xDrive']);
      assert.deepEqual(await names('bmW'), []);
      assert.deepEqual(await names('bMW'), []);
    } finally {
      axios.get = original;
      cacheClear();
      carquery.clearModelsCache();
      if (keys.size) {
        await db.sequelize.query('DELETE FROM api_cache WHERE key IN (:keys)', { replacements: { keys: [...keys] } });
      }
    }
  });

  it('resolves an unseeded read without creating a row and initializes exact years on explicit creation', async function() {
    const identity = { make: 'BMW', model: '528i xDrive' };
    const original = carquery.getModels;
    const requests = [];
    let created;
    carquery.getModels = async make => {
      requests.push(make);
      return [];
    };
    try {
      assert.deepEqual(await lookupCatalogCar('bmw', '528I XDRIVE'), { ...identity, car: null, type: 'car' });
      assert.equal(await db.car.findOne({ where: identity }), null);
      assert.deepEqual(requests, []);

      created = await findOrCreateCatalogCar('BMW', '528i xDrive');
      assert.ok(created);
      assert.equal(created.make, identity.make);
      assert.equal(created.model, identity.model);
      assert.equal(created.image, PLACEHOLDER_URL);
      assert.equal(created.vehicle_type, 'car');
      assert.equal(created.years_checked, true);
      assert.deepEqual(created.model_years, [2009, 2010, 2012, 2013, 2014, 2015, 2016]);
      assert.equal(created.year_min, 2009);
      assert.equal(created.year_max, 2016);
      assert.equal((await findOrCreateCatalogCar('bmw', '528I XDRIVE')).id, created.id);
      assert.deepEqual(requests, []);
      assert.equal(await findOrCreateCatalogCar('BMW', '528i xDrive Sport'), null);
      assert.deepEqual(requests, ['BMW']);
    } finally {
      carquery.getModels = original;
      if (created) await created.destroy();
    }
  });
});
