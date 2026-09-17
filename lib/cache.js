// Tiny in-memory TTL cache for slow-changing external API responses.
// Used by the car detail page (Wikipedia, NHTSA, FuelEconomy) and the
// manufacturer list — these were re-fetched on every request.
const axios = require('axios');

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h
const MAX_ENTRIES = 500;

const store = new Map(); // key -> { at, data }

async function cachedGet(url, { ttl = DEFAULT_TTL, headers, timeout = 6000, params } = {}) {
  const key = params ? url + '?' + new URLSearchParams(params).toString() : url;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  const res = await axios.get(url, { timeout, headers, params });
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key, { at: Date.now(), data: res.data });
  return res.data;
}

// Return a cached value without fetching; used for optional lookups.
function cacheClear() {
  store.clear();
}

module.exports = { cachedGet, cacheClear, DEFAULT_TTL };
