const assert = require('node:assert/strict');
const axios = require('axios');
const db = require('../models');
const { cachedGet, cacheClear } = require('../lib/cache');

const PREFIX = 'https://cache-concurrency.test/';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

describe('coalesced external API cache', function() {
  let realGet, realQuery, realNow, now;

  beforeEach(async function() {
    realGet = axios.get;
    realQuery = db.sequelize.query;
    realNow = Date.now;
    now = Date.UTC(2026, 9, 15, 21);
    Date.now = () => now;
    cacheClear();
    await db.sequelize.query('DELETE FROM api_cache WHERE key LIKE :prefix', {
      replacements: { prefix: PREFIX + '%' }
    });
  });

  afterEach(function() {
    axios.get = realGet;
    db.sequelize.query = realQuery;
    Date.now = realNow;
    cacheClear();
  });

  async function seed(key, data, age, notFound = false) {
    await db.sequelize.query(`
      INSERT INTO api_cache (key, data, "notFound", "fetchedAt")
      VALUES (:key, CAST(:json AS JSONB), :notFound, :at)
    `, { replacements: { key, json: data === null ? null : JSON.stringify(data), notFound, at: new Date(now - age) } });
  }

  async function row(key) {
    const [rows] = await realQuery.call(db.sequelize,
      'SELECT data, "notFound", "fetchedAt" FROM api_cache WHERE key = :key',
      { replacements: { key } }
    );
    return rows[0];
  }

  function countReads() {
    let reads = 0;
    db.sequelize.query = function(sql, options) {
      if (/^SELECT data, "notFound", "fetchedAt" FROM api_cache/.test(sql)) reads++;
      return realQuery.call(this, sql, options);
    };
    return () => reads;
  }

  it('shares one durable read and upstream request for simultaneous misses', async function() {
    const started = deferred(), response = deferred();
    const reads = countReads();
    let calls = 0;
    axios.get = () => { calls++; started.resolve(); return response.promise; };
    const requests = Array.from({ length: 5 }, () => cachedGet(PREFIX + 'cold'));
    await started.promise;
    assert.equal(calls, 1);
    assert.equal(reads(), 1);
    response.resolve({ data: { version: 1 } });
    assert.deepEqual(await Promise.all(requests), Array(5).fill({ version: 1 }));
    assert.deepEqual((await row(PREFIX + 'cold')).data, { version: 1 });
    assert.deepEqual(await cachedGet(PREFIX + 'cold'), { version: 1 });
    assert.equal(calls, 1);
  });

  for (const strictFirst of [false, true]) {
    it(`honors each caller's TTL when the ${strictFirst ? 'strict' : 'long'}-TTL reader joins first`, async function() {
      const key = PREFIX + `mixed-${strictFirst}`;
      await seed(key, { version: 'durable' }, 5 * 60 * 1000);
      const started = deferred(), response = deferred();
      const reads = countReads();
      let calls = 0;
      axios.get = () => { calls++; started.resolve(); return response.promise; };
      const long = () => cachedGet(key, { ttl: 10 * 60 * 1000 });
      const strict = () => cachedGet(key, { ttl: 60 * 1000 });
      const first = strictFirst ? strict() : long();
      const second = strictFirst ? long() : strict();
      await started.promise;
      response.resolve({ data: { version: 'refreshed' } });
      const results = await Promise.all([first, second]);
      assert.deepEqual(results, strictFirst
        ? [{ version: 'refreshed' }, { version: 'durable' }]
        : [{ version: 'durable' }, { version: 'refreshed' }]);
      assert.equal(calls, 1);
      assert.equal(reads(), 1);
      assert.deepEqual((await row(key)).data, { version: 'refreshed' });
    });
  }

  it('coalesces and persists 404s, including after a memory reset', async function() {
    const started = deferred(), response = deferred();
    let calls = 0;
    axios.get = () => { calls++; started.resolve(); return response.promise; };
    const requests = Array.from({ length: 3 }, () => cachedGet(PREFIX + 'missing'));
    const settled = Promise.allSettled(requests);
    await started.promise;
    response.reject(httpError(404));
    const results = await settled;
    assert.ok(results.every(r => r.status === 'rejected' && r.reason.response.status === 404));
    await assert.rejects(cachedGet(PREFIX + 'missing'), e => e.response.status === 404);
    cacheClear();
    await assert.rejects(cachedGet(PREFIX + 'missing'), e => e.response.status === 404);
    assert.equal(calls, 1);
    assert.equal((await row(PREFIX + 'missing')).notFound, true);
  });

  it('serves stale data during cooldown and retries at expiry without renewing its durable age', async function() {
    const key = PREFIX + 'stale';
    await seed(key, { version: 'old' }, 2000);
    const originalAt = now - 2000;
    let calls = 0;
    axios.get = async () => { calls++; throw httpError(503); };
    assert.deepEqual(await cachedGet(key, { ttl: 1000 }), { version: 'old' });
    const reads = countReads();
    now += 29999;
    assert.deepEqual(await cachedGet(key, { ttl: 0 }), { version: 'old' });
    assert.equal(calls, 1);
    assert.equal(reads(), 0);
    assert.equal(new Date((await row(key)).fetchedAt).getTime(), originalAt);
    now++;
    axios.get = async () => { calls++; return { data: { version: 'new' } }; };
    assert.deepEqual(await cachedGet(key, { ttl: 1000 }), { version: 'new' });
    assert.equal(calls, 2);
    assert.equal(new Date((await row(key)).fetchedAt).getTime(), now);
    assert.deepEqual(await cachedGet(key, { ttl: 1000 }), { version: 'new' });
    assert.equal(calls, 2);
  });

  it('shares an expired-entry refresh and still throws a stale 404 during an outage cooldown', async function() {
    const key = PREFIX + 'stale-missing';
    await seed(key, null, 2000, true);
    const started = deferred(), response = deferred();
    let calls = 0;
    axios.get = () => { calls++; started.resolve(); return response.promise; };
    const settled = Promise.allSettled(Array.from({ length: 3 }, () => cachedGet(key, { ttl: 1000 })));
    await started.promise;
    response.reject(new Error('ECONNRESET'));
    assert.ok((await settled).every(r => r.status === 'rejected' && r.reason.response.status === 404));
    await assert.rejects(cachedGet(key, { ttl: 1000 }), e => e.response.status === 404);
    assert.equal(calls, 1);
    const cached = await row(key);
    assert.equal(cached.notFound, true);
    assert.equal(new Date(cached.fetchedAt).getTime(), now - 2000);
  });

  it('cleans up rejected cold requests and retries without a stale-data cooldown', async function() {
    const started = deferred(), response = deferred();
    let calls = 0;
    axios.get = () => { calls++; started.resolve(); return response.promise; };
    const settled = Promise.allSettled(Array.from({ length: 3 }, () => cachedGet(PREFIX + 'cold-outage')));
    await started.promise;
    const error = httpError(503);
    response.reject(error);
    assert.ok((await settled).every(r => r.status === 'rejected' && r.reason === error));
    axios.get = async () => { calls++; throw error; };
    await assert.rejects(cachedGet(PREFIX + 'cold-outage'), e => e === error);
    axios.get = async () => { calls++; return { data: 'recovered' }; };
    assert.equal(await cachedGet(PREFIX + 'cold-outage'), 'recovered');
    assert.equal(calls, 3);
  });

  it('keeps parameter variants in separate flights and durable rows', async function() {
    const replies = { a: deferred(), b: deferred() };
    const started = deferred();
    let calls = 0;
    axios.get = (url, { params }) => {
      calls++;
      if (calls === 2) started.resolve();
      return replies[params.model].promise;
    };
    const requests = ['a', 'b', 'a', 'b'].map(model => cachedGet(PREFIX + 'params', { params: { model } }));
    await started.promise;
    replies.a.resolve({ data: 'alpha' });
    replies.b.resolve({ data: 'beta' });
    assert.deepEqual(await Promise.all(requests), ['alpha', 'beta', 'alpha', 'beta']);
    assert.equal(calls, 2);
    assert.equal((await row(PREFIX + 'params?model=a')).data, 'alpha');
    assert.equal((await row(PREFIX + 'params?model=b')).data, 'beta');
  });

  it('does not apply a transient cooldown to a nontransient HTTP error', async function() {
    const key = PREFIX + 'forbidden';
    await seed(key, 'stale', 2000);
    let calls = 0;
    axios.get = async () => { calls++; throw httpError(403); };
    assert.equal(await cachedGet(key, { ttl: 1000 }), 'stale');
    assert.equal(await cachedGet(key, { ttl: 1000 }), 'stale');
    assert.equal(calls, 2);
    assert.equal(new Date((await row(key)).fetchedAt).getTime(), now - 2000);
  });

  it('keeps old work from repopulating memory or deleting a new flight after cacheClear', async function() {
    const key = PREFIX + 'clear-race';
    const oldStarted = deferred(), newStarted = deferred();
    const oldResponse = deferred(), newResponse = deferred();
    let calls = 0;
    axios.get = () => {
      calls++;
      if (calls === 1) { oldStarted.resolve(); return oldResponse.promise; }
      newStarted.resolve();
      return newResponse.promise;
    };
    const oldRequest = cachedGet(key);
    await oldStarted.promise;
    cacheClear();
    const newRequest = cachedGet(key);
    await newStarted.promise;
    oldResponse.resolve({ data: 'old' });
    assert.equal(await oldRequest, 'old');
    const joined = cachedGet(key);
    newResponse.resolve({ data: 'new' });
    assert.deepEqual(await Promise.all([newRequest, joined]), ['new', 'new']);
    assert.equal(calls, 2);
    assert.equal(await cachedGet(key), 'new');
    assert.equal((await row(key)).data, 'new');
  });

  it('continues to work when durable cache reads and writes fail', async function() {
    db.sequelize.query = async () => { throw new Error('database unavailable'); };
    let calls = 0;
    axios.get = async () => { calls++; return { data: 'available' }; };
    assert.equal(await cachedGet(PREFIX + 'db-outage'), 'available');
    assert.equal(await cachedGet(PREFIX + 'db-outage'), 'available');
    assert.equal(calls, 1);
  });
});
