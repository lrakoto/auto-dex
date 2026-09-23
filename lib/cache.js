// Two-level TTL cache for slow-changing external API responses: a bounded
// in-memory map in front of the api_cache table, so lookups survive deploys.
// 404s are cached too (as "not found"), otherwise every view of a car whose
// Wikipedia title guess misses would re-request it. If a refresh fails and a
// stale copy exists, the stale copy is served.
const axios = require('axios');

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h
const MAX_ENTRIES = 500;
const MAX_PERSIST_BYTES = 512 * 1024; // don't park huge payloads in Postgres

const store = new Map(); // key -> { at, data, notFound }

// Lazy so this module doesn't pull in the models (and a DB connection) for
// callers that never hit it
let db = null;
function getDb() {
  if (!db) db = require('../models');
  return db;
}

function notFoundError(url) {
  const err = new Error(`Not found: ${url}`);
  err.response = { status: 404 };
  return err;
}

function remember(key, entry) {
  if (store.has(key)) store.delete(key); // refresh insertion order
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key, entry);
}

function unwrap(entry, url) {
  if (entry.notFound) throw notFoundError(url);
  return entry.data;
}

async function readDurable(key) {
  try {
    const [row] = await getDb().sequelize.query(
      'SELECT data, "notFound", "fetchedAt" FROM api_cache WHERE key = :key',
      { replacements: { key }, type: getDb().Sequelize.QueryTypes.SELECT }
    );
    return row ? { at: new Date(row.fetchedAt).getTime(), data: row.data, notFound: row.notFound } : null;
  } catch (e) {
    return null; // cache is best-effort; never fail a page over it
  }
}

async function writeDurable(key, entry) {
  try {
    const json = entry.notFound ? null : JSON.stringify(entry.data);
    if (json && json.length > MAX_PERSIST_BYTES) return;
    await getDb().sequelize.query(`
      INSERT INTO api_cache (key, data, "notFound", "fetchedAt")
      VALUES (:key, CAST(:json AS JSONB), :notFound, :at)
      ON CONFLICT (key) DO UPDATE
        SET data = EXCLUDED.data, "notFound" = EXCLUDED."notFound", "fetchedAt" = EXCLUDED."fetchedAt"
    `, { replacements: { key, json, notFound: !!entry.notFound, at: new Date(entry.at) } });
  } catch (e) { /* best-effort */ }
}

async function cachedGet(url, { ttl = DEFAULT_TTL, headers, timeout = 6000, params } = {}) {
  const key = params ? url + '?' + new URLSearchParams(params).toString() : url;
  const fresh = e => e && Date.now() - e.at < ttl;

  const hit = store.get(key);
  if (fresh(hit)) return unwrap(hit, url);

  const durable = await readDurable(key);
  if (fresh(durable)) {
    remember(key, durable);
    return unwrap(durable, url);
  }

  let entry;
  try {
    const res = await axios.get(url, { timeout, headers, params });
    entry = { at: Date.now(), data: res.data, notFound: false };
  } catch (err) {
    if (err.response && err.response.status === 404) {
      entry = { at: Date.now(), data: null, notFound: true };
    } else {
      const stale = hit || durable;
      if (stale) return unwrap(stale, url); // upstream down — serve what we had
      throw err;
    }
  }
  remember(key, entry);
  await writeDurable(key, entry);
  return unwrap(entry, url);
}

// Drop durable rows nobody could still consider fresh
async function pruneCache(olderThanMs = 30 * 24 * 60 * 60 * 1000) {
  const [, meta] = await getDb().sequelize.query(
    'DELETE FROM api_cache WHERE "fetchedAt" < :cutoff',
    { replacements: { cutoff: new Date(Date.now() - olderThanMs) } }
  );
  return meta && meta.rowCount;
}

function cacheClear() {
  store.clear();
}

module.exports = { cachedGet, cacheClear, pruneCache, DEFAULT_TTL };
