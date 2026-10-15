// Two-level TTL cache for slow-changing external API responses: a bounded
// in-memory map in front of the api_cache table, so lookups survive deploys.
// 404s are cached too (as "not found"), otherwise every view of a car whose
// Wikipedia title guess misses would re-request it. If a refresh fails and a
// stale copy exists, the stale copy is served. Concurrent reads share work
// within this process. After a transient refresh failure, stale data is served
// for 30s before retrying, without changing its original fetch age.
const axios = require('axios');

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h
const MAX_ENTRIES = 500;
const MAX_PERSIST_BYTES = 512 * 1024; // don't park huge payloads in Postgres
const RETRY_COOLDOWN = 30 * 1000;

const store = new Map(); // key -> { at, data, notFound, retryAt? }
const pending = new Map(); // key -> shared durable read and optional refresh
let generation = 0;

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

function newest(a, b) {
  return !a || (b && b.at > a.at) ? b : a;
}

function transientError(err) {
  const status = err.response && err.response.status;
  return !err.response || status === 408 || status === 429 || (status >= 500 && status < 600);
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
  if (hit && hit.retryAt > Date.now()) return unwrap(hit, url);

  let flight = pending.get(key);
  if (!flight) {
    flight = { generation, readers: 0, durable: readDurable(key), refresh: null };
    // Don't evict active requests to make room: overflow keys still work,
    // without coalescing, and the registry remains bounded.
    if (pending.size < MAX_ENTRIES) pending.set(key, flight);
  }
  flight.readers++;

  try {
    const durable = await flight.durable;
    const memory = store.get(key);
    // Freshness belongs to the caller, not the first reader's TTL. A strict
    // caller can refresh a durable entry that a longer-TTL reader accepts.
    if (fresh(memory)) return unwrap(memory, url);
    if (fresh(durable)) {
      if (flight.generation === generation) remember(key, durable);
      return unwrap(durable, url);
    }
    const stale = newest(newest(memory, hit), durable);
    if (stale && stale.retryAt > Date.now()) return unwrap(stale, url);

    if (!flight.refresh) {
      flight.refresh = (async () => {
        let entry;
        try {
          const res = await axios.get(url, { timeout, headers, params });
          entry = { at: Date.now(), data: res.data, notFound: false };
        } catch (err) {
          if (err.response && err.response.status === 404) {
            entry = { at: Date.now(), data: null, notFound: true };
          } else {
            if (!stale) throw err;
            // Retain the original age. Failed refreshes never make old data
            // fresh or overwrite its durable timestamp.
            const fallback = transientError(err)
              ? { ...stale, retryAt: Date.now() + RETRY_COOLDOWN }
              : stale;
            if (flight.generation === generation) remember(key, fallback);
            return fallback;
          }
        }
        if (flight.generation === generation) {
          remember(key, entry);
          await writeDurable(key, entry);
        }
        return entry;
      })();
    }
    return unwrap(await flight.refresh, url);
  } finally {
    flight.readers--;
    if (!flight.readers && pending.get(key) === flight) pending.delete(key);
  }
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
  generation++;
  store.clear();
  pending.clear();
}

module.exports = { cachedGet, cacheClear, pruneCache, DEFAULT_TTL };
