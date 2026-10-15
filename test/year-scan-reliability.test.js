const assert = require('node:assert/strict');
const axios = require('axios');
const db = require('../models');
const nhtsa = require('../lib/nhtsa');
const { scanMake, scanYears } = require('../jobs/years');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('Complete model-year scans', function() {
  let realGet, realGetModelYears, realFindAll;
  const range = { fromYear: 2020, toYear: 2022, delayMs: 0 };
  const row = (make, model) => ({ Make_Name: make, Model_Name: model });
  const yearOf = url => Number(url.match(/modelyear\/(\d+)/)[1]);
  const fields = car => [car.model_years, car.year_min, car.year_max, car.years_checked];

  beforeEach(function() {
    realGet = axios.get;
    realGetModelYears = nhtsa.getModelYears;
    realFindAll = db.car.findAll;
  });
  afterEach(function() {
    axios.get = realGet;
    nhtsa.getModelYears = realGetModelYears;
    db.car.findAll = realFindAll;
  });

  it('accepts empty years, preserves gaps, deduplicates and ignores other makes', async function() {
    axios.get = async url => ({ data: { Results: yearOf(url) === 2021 ? [] : [
      row('MG', 'Fixture'), row('MG', 'Fixture'), row('MGM Trailers', 'Other')
    ] } });
    const years = await nhtsa.getModelYears('MG', range);
    assert.deepEqual([...years], [['Fixture', [2020, 2022]]]);
  });

  it('rejects a failed year after earlier success and stops the scan', async function() {
    const requested = [];
    const failure = new Error('upstream unavailable');
    axios.get = async url => {
      const year = yearOf(url);
      requested.push(year);
      if (year === 2021) throw failure;
      return { data: { Results: [row('MG', 'Fixture')] } };
    };
    await assert.rejects(nhtsa.getModelYears('MG', range), err =>
      err.cause === failure && /MG \(2021\)/.test(err.message));
    assert.deepEqual(requested, [2020, 2021]);
  });

  it('rejects malformed yearly payloads instead of treating them as no models', async function() {
    for (const data of [null, '<html>unavailable</html>', {}, { Results: null }, { Results: {} }, { Results: 'none' }]) {
      axios.get = async () => ({ data });
      await assert.rejects(nhtsa.getModelYears('MG', range), /Invalid model-year response/);
    }
    for (const model of [undefined, null, '', ' ', 123]) {
      axios.get = async () => ({ data: { Results: [row('MG', model)] } });
      await assert.rejects(nhtsa.getModelYears('MG', range), /Invalid model name/);
    }
  });

  it('preserves all stored years and flags on failure, then commits a complete retry', async function() {
    const make = 'Year Scan Retry Fixture';
    const known = await db.car.create({ make, model: 'Known', image: PLACEHOLDER_URL,
      model_years: [2018, 2019, 2020], year_min: 2018, year_max: 2020, years_checked: false });
    const undated = await db.car.create({ make, model: 'Undated', image: PLACEHOLDER_URL, years_checked: false });
    const checked = await db.car.create({ make, model: 'Checked', image: PLACEHOLDER_URL,
      model_years: [2000], year_min: 2000, year_max: 2000, years_checked: true });
    nhtsa.getModelYears = name => realGetModelYears(name, range);
    let fail = true;
    axios.get = async url => {
      if (yearOf(url) === 2021) {
        if (fail) throw new Error('temporary failure');
        return { data: { Results: [] } };
      }
      return { data: { Results: [row(make, 'Known')] } };
    };
    await assert.rejects(scanMake(make), /temporary failure/);
    assert.deepEqual(fields(await known.reload()), [[2018, 2019, 2020], 2018, 2020, false]);
    assert.deepEqual(fields(await undated.reload()), [null, null, null, false]);
    assert.deepEqual(fields(await checked.reload()), [[2000], 2000, 2000, true]);

    fail = false;
    await scanMake(make);
    assert.deepEqual(fields(await known.reload()), [[2020, 2022], 2020, 2022, true]);
    assert.deepEqual(fields(await undated.reload()), [null, null, null, true]);
    assert.deepEqual(fields(await checked.reload()), [[2000], 2000, 2000, true]);
    assert.equal(await db.car.count({ where: { make } }), 3);
  });

  it('keeps a failed make pending while continuing other makes and retries it later', async function() {
    const failedMake = 'Year Scan A Fixture', goodMake = 'Year Scan B Fixture';
    const failed = await db.car.create({ make: failedMake, model: 'Fixture', image: PLACEHOLDER_URL, years_checked: false });
    const good = await db.car.create({ make: goodMake, model: 'Fixture', image: PLACEHOLDER_URL, years_checked: false });
    db.car.findAll = options => realFindAll.call(db.car, {
      ...options, where: { ...options.where, make: [failedMake, goodMake] }
    });
    const requested = [];
    let fail = true;
    nhtsa.getModelYears = async make => {
      requested.push(make);
      if (make === failedMake && fail) throw new Error('incomplete');
      return new Map([['Fixture', [2020]]]);
    };
    await scanYears();
    assert.deepEqual(requested, [failedMake, goodMake]);
    assert.equal((await failed.reload()).years_checked, false);
    assert.equal((await good.reload()).years_checked, true);
    requested.length = 0;
    fail = false;
    await scanYears();
    assert.deepEqual(requested, [failedMake]);
    assert.equal((await failed.reload()).years_checked, true);
  });
});
