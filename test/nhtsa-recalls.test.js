const assert = require('node:assert/strict');
const axios = require('axios');
const db = require('../models');
const nhtsa = require('../lib/nhtsa');
const { cacheClear } = require('../lib/cache');
const { checkRecalls } = require('../jobs/recalls');

// NHTSA's "nothing under that name": HTTP 400 with a success message
const emptyAnswer = () => Object.assign(new Error('Request failed with status code 400'), {
  response: { status: 400, data: { Count: 0, Message: 'Results returned successfully', results: [] } }
});
const recall = (campaign, component = 'BRAKES') => ({ NHTSACampaignNumber: campaign, Component: component, Summary: `Recall ${campaign}` });

describe('NHTSA recalls', function() {
  let realGet;
  beforeEach(function() { realGet = axios.get; cacheClear(); });
  afterEach(function() { axios.get = realGet; });

  // Fixture names throughout: answers are cached durably across tests
  it('reads NHTSA\'s 400 "Results returned successfully" as no recalls, and remembers it', async function() {
    let asked = 0;
    axios.get = async url => {
      if (url.includes('/products/')) return { data: { results: [] } };
      asked++;
      throw emptyAnswer();
    };
    assert.deepEqual(await nhtsa.getRecalls('Fixturemazda', 'Roadster One', 1991), []);
    assert.deepEqual(await nhtsa.getRecalls('Fixturemazda', 'Roadster One', 1991), []);
    assert.equal(asked, 1, 'the empty answer is not re-asked on the next view');
  });

  it('still throws on a real failure, so callers can say they could not check', async function() {
    axios.get = async () => { throw Object.assign(new Error('Service Unavailable'), { response: { status: 503, data: 'down' } }); };
    await assert.rejects(nhtsa.getRecalls('Fixturemazda', 'Outage Model', 2020), /Service Unavailable/);
    axios.get = async () => { throw Object.assign(new Error('Bad Request'), { response: { status: 400, data: { Message: 'Invalid model year' } } }); };
    await assert.rejects(nhtsa.getRecalls('Fixturemazda', 'Bad Year', 2020), /Bad Request/);
  });

  it('finds recalls filed under a longer name, once per campaign', async function() {
    axios.get = async (url, { params } = {}) => {
      if (url.includes('/products/')) {
        return { data: { results: [{ model: 'SEDANO HYBRID' }, { model: 'SEDANO HYBRID AWD' }, { model: 'SEDANOX' }, { model: 'COUPE' }] } };
      }
      if (params.model === 'SEDANO HYBRID') return { data: { results: [recall('25V001'), recall('25V002')] } };
      if (params.model === 'SEDANO HYBRID AWD') return { data: { results: [recall('25V002'), recall('25V003')] } };
      if (params.model === 'SEDANOX') return { data: { results: [recall('25V999')] } };
      throw emptyAnswer(); // the plain name
    };
    const recalls = await nhtsa.getRecalls('Fixturetoyota', 'Sedano', 2025);
    assert.deepEqual(recalls.map(r => r.campaign).sort(), ['25V001', '25V002', '25V003'], 'SEDANOX is another model; 25V002 counted once');
  });

  it('lets the recall-alert job record a baseline for such a car instead of retrying forever', async function() {
    const user = await db.user.create({ name: 'Recall E', email: 'recall-empty@example.com', password: 'password123', emailVerified: true, recallAlerts: true });
    const car = await db.user_car.create({ userId: user.id, make: 'Fixturemazda', model: 'Roadster Two', year: '1991' });
    axios.get = async url => {
      if (url.includes('/products/')) return { data: { results: [] } };
      throw emptyAnswer();
    };
    await checkRecalls({ delayMs: 0 });
    await car.reload();
    assert.ok(car.recalls_checked_at, 'checked');
    assert.deepEqual(car.recalls_seen, [], 'baseline recorded as "no recalls"');
  });
});
