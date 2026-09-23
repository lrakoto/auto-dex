const request = require('supertest');
const axios = require('axios');
const app = require('../server');

describe('Fixes', function() {
  describe('make pages', function() {
    it('give each make its own canonical URL', async function() {
      const res = await request(app).get('/cars?selectmake=Toyota').expect(200);
      if (!/rel="canonical" href="[^"]*\/cars\?selectmake=Toyota"/.test(res.text)) {
        throw new Error('canonical is not the make page: ' + (res.text.match(/rel="canonical" href="[^"]+"/) || [])[0]);
      }
    });

    it('list curated models for makes NHTSA does not cover', async function() {
      const res = await request(app).get('/cars?selectmake=' + encodeURIComponent('Škoda')).expect(200);
      if (res.text.includes('No models found')) throw new Error('Škoda still empty');
      if (!res.text.includes('Octavia')) throw new Error('curated Škoda model missing');
    });
  });

  describe('make countries', function() {
    const { getMakeCountry, MAKES_LIST } = require('../config/carquery');

    it('uses the brand origin, not the NHTSA filing entity', function() {
      if (getMakeCountry('Toyota') !== 'Japan') throw new Error('Toyota country wrong');
      if (getMakeCountry('SKODA') !== 'Czech Republic') throw new Error('spelling variants should resolve');
    });

    it('covers every make in the list', function() {
      const missing = MAKES_LIST.filter(m => !getMakeCountry(m));
      if (missing.length) throw new Error('no country for: ' + missing.join(', '));
    });
  });

  describe('durable API cache', function() {
    const { cachedGet, cacheClear } = require('../lib/cache');
    let realGet, calls;

    beforeEach(function() {
      realGet = axios.get;
      calls = 0;
      cacheClear();
    });
    afterEach(function() { axios.get = realGet; });

    it('serves from Postgres after the in-memory cache is gone (a deploy)', async function() {
      axios.get = async () => { calls++; return { data: { hello: 'world' } }; };
      await cachedGet('https://example.test/a');
      cacheClear(); // simulate a restart
      const data = await cachedGet('https://example.test/a');
      if (calls !== 1) throw new Error(`expected 1 upstream call, got ${calls}`);
      if (data.hello !== 'world') throw new Error('wrong data from durable cache');
    });

    it('caches 404s so misses are not re-requested', async function() {
      axios.get = async () => { calls++; const e = new Error('nope'); e.response = { status: 404 }; throw e; };
      for (let i = 0; i < 2; i++) {
        try { await cachedGet('https://example.test/missing'); throw new Error('should have thrown'); }
        catch (e) { if (!e.response || e.response.status !== 404) throw e; }
      }
      if (calls !== 1) throw new Error(`404 re-requested: ${calls} calls`);
    });

    it('serves a stale copy when the upstream is down', async function() {
      axios.get = async () => ({ data: { v: 1 } });
      await cachedGet('https://example.test/stale');
      axios.get = async () => { throw new Error('ECONNRESET'); };
      const data = await cachedGet('https://example.test/stale', { ttl: 0 });
      if (data.v !== 1) throw new Error('stale copy not served');
    });
  });
});
