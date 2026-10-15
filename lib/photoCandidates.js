// Admin-reviewed photo discovery. Search results never change a catalog car:
// the approval route re-resolves an opaque provider ID through these fixed APIs.
// https://www.mediawiki.org/wiki/API:Imageinfo
// https://api.openverse.org/v1/
const cache = require('./cache'); // module object so callers/tests can stub it
const wikimedia = require('./wikimedia');
const { isIP } = require('net');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const HEADERS = { 'User-Agent': 'AutoDex/1.0 (https://github.com/lrakoto/auto-dex)' };
const LIMIT = 6;
const SEARCH_TTL = 60 * 60 * 1000;
const DETAIL_TTL = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMONS_ID = /^File:[^\u0000-\u001f\u007f#<>\[\]{}|]+\.(?:jpe?g|png|webp)$/i;
const RASTER = new Set(['jpg', 'jpeg', 'png', 'webp', 'image/jpeg', 'image/png', 'image/webp']);

function text(value, max = 512) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|nbsp|lt|gt);/gi, (whole, entity) => {
    const named = { amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>' };
    if (entity[0] !== '#') return named[entity.toLowerCase()];
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return number >= 32 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : ' ';
  }).replace(/\s+/g, ' ').trim().slice(0, max);
}

// These URLs are displayed to a browser, never fetched as an approval target.
// Reject executable schemes, credentials and ambiguous URL spellings.
function webUrl(value, httpsOnly = false) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (httpsOnly && url.protocol !== 'https:') return null;
    if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return null;
    if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) return null;
    if (/(^|\.)unsplash\.(com|it|net)$/i.test(url.hostname)) return null;
    return url.href.replace(/['"()<>]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch (err) { return null; }
}

// Use only the unambiguous Creative Commons licenses supported by this flow.
// A provider's short name must agree with its official license URL.
function licenseInfo(label, link) {
  const value = text(label, 80);
  const safe = webUrl(link);
  if (!value || !safe) return null;
  const url = new URL(safe);
  if (!['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname)) return null;
  const by = url.pathname.match(/^\/licenses\/(by|by-sa)\/(\d\.\d)(?:\/[a-z-]+)?\/?$/i);
  if (by) {
    const kind = by[1].toUpperCase();
    const expected = `CC ${kind} ${by[2]}`;
    if (value.toUpperCase() !== expected) return null;
    return { license: expected, licenseUrl: `https://creativecommons.org${url.pathname}` };
  }
  if (/^\/publicdomain\/zero\/1\.0\/?$/i.test(url.pathname) && /^CC0(?: 1\.0)?$/i.test(value)) {
    return { license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  }
  if (/^\/publicdomain\/mark\/1\.0\/?$/i.test(url.pathname) && /^(?:Public domain|PDM(?: 1\.0)?)$/i.test(value)) {
    return { license: 'Public domain', licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/' };
  }
  return null;
}

function dimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width >= 640 && height > 0 && width > height;
}

function validContext(make, model) {
  return typeof make === 'string' && typeof model === 'string' && make.trim().length > 0 && model.trim().length > 0
    && make.length <= 100 && model.length <= 200 && !/[\u0000-\u001f\u007f]/.test(make + model);
}

function validCommonsId(id) {
  return typeof id === 'string' && id.length <= 512 && COMMONS_ID.test(id) && !/[\r\n]/.test(id);
}

function commonsCandidate(page) {
  if (!page || page.missing || page.ns !== 6 || !validCommonsId(page.title)) return null;
  const info = page.imageinfo && page.imageinfo[0];
  if (!info || !RASTER.has(info.mime) || !dimensions(info.width, info.height)) return null;
  const original = webUrl(info.url, true);
  const sourceUrl = webUrl(info.descriptionurl);
  if (!original || !sourceUrl || new URL(original).hostname !== 'upload.wikimedia.org' || new URL(sourceUrl).hostname !== 'commons.wikimedia.org') return null;
  const file = wikimedia.commonsFile(original);
  if (!file) return null;
  const meta = info.extmetadata || {};
  const value = key => meta[key] && meta[key].value;
  const creditName = text(value('Artist'));
  const license = licenseInfo(value('LicenseShortName'), value('LicenseUrl'));
  if (!creditName || !license) return null;
  return {
    provider: 'wikimedia', id: page.title, title: text(page.title.slice(5).replace(/_/g, ' ')),
    url: wikimedia.thumbUrl(file, wikimedia.fitWidth(1280, info.width)),
    previewUrl: wikimedia.thumbUrl(file, 500), sourceUrl, creditName, ...license
  };
}

function openverseCandidate(item) {
  if (!item || typeof item.id !== 'string' || !UUID.test(item.id) || item.mature === true
    || !dimensions(item.width, item.height)) return null;
  if ([item.provider, item.source].some(value => typeof value === 'string' && /unsplash/i.test(value))) return null;
  const code = typeof item.license === 'string' && item.license.toLowerCase();
  if (!['by', 'by-sa', 'cc0', 'pdm'].includes(code)) return null;
  const label = code === 'pdm' ? 'Public domain' : code === 'cc0' ? 'CC0 1.0' : `CC ${code.toUpperCase()} ${item.license_version}`;
  const license = licenseInfo(label, item.license_url);
  const url = webUrl(item.url, true), sourceUrl = webUrl(item.foreign_landing_url);
  const title = text(item.title), creditName = text(item.creator);
  if (!license || !url || !sourceUrl || !title || !creditName) return null;
  // Openverse often omits filetype for otherwise complete Flickr records.
  // Infer only a known raster extension from the already validated media path;
  // an explicit unsupported filetype is never rescued by its URL spelling.
  if (item.filetype == null ? !/\.(jpe?g|png|webp)$/i.test(new URL(url).pathname) : !RASTER.has(item.filetype)) return null;
  return {
    provider: 'openverse', id: item.id.toLowerCase(), title, url,
    previewUrl: webUrl(item.thumbnail, true) || url, sourceUrl, creditName, ...license
  };
}

const COMMONS_PARAMS = {
  action: 'query', format: 'json', formatversion: 2, prop: 'imageinfo',
  iiprop: 'url|size|mime|extmetadata', iiurlwidth: 500,
  iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl'
};

async function searchCommons(make, model) {
  const data = await cache.cachedGet(COMMONS_API, {
    params: { ...COMMONS_PARAMS, generator: 'search', gsrsearch: `${make} ${model}`, gsrnamespace: 6, gsrlimit: LIMIT },
    ttl: SEARCH_TTL, headers: HEADERS, timeout: 6000
  });
  if (!data || data.error || (data.query && !Array.isArray(data.query.pages))) throw new Error('Invalid Commons response');
  return (data.query ? data.query.pages : []).slice(0, LIMIT).map(commonsCandidate).filter(Boolean);
}

async function searchOpenverse(make, model) {
  const data = await cache.cachedGet(OPENVERSE_API, {
    params: { q: `${make} ${model}`, page_size: LIMIT, license: 'by,by-sa,cc0,pdm', extension: 'jpg,jpeg,png,webp', mature: false },
    ttl: SEARCH_TTL, headers: HEADERS, timeout: 6000
  });
  if (!data || !Array.isArray(data.results)) throw new Error('Invalid Openverse response');
  return data.results.slice(0, LIMIT).map(openverseCandidate).filter(Boolean);
}

async function searchCandidates(make, model) {
  if (!validContext(make, model)) return { candidates: [], errors: [] };
  const results = await Promise.allSettled([searchCommons(make, model), searchOpenverse(make, model)]);
  const candidates = [], errors = [];
  results.forEach((result, index) => {
    const provider = index ? 'openverse' : 'wikimedia';
    if (result.status === 'fulfilled') candidates.push(...result.value);
    else errors.push({ provider, message: `${index ? 'Openverse' : 'Wikimedia Commons'} is unavailable. Try again later.` });
  });
  // Titles are only a relevance hint, never proof of the pictured model.
  candidates.sort((a, b) => Number(wikimedia.titleMatches(b.title, make, model)) - Number(wikimedia.titleMatches(a.title, make, model)));
  return { candidates, errors };
}

async function getCandidate(provider, id, make, model) {
  if (!validContext(make, model)) return null;
  try {
    if (provider === 'wikimedia' && validCommonsId(id)) {
      const data = await cache.cachedGet(COMMONS_API, {
        params: { ...COMMONS_PARAMS, titles: id }, ttl: DETAIL_TTL, headers: HEADERS, timeout: 6000
      });
      if (!data || data.error || !data.query || !Array.isArray(data.query.pages)) throw new Error('Invalid Commons response');
      const page = data.query.pages.find(page => page.title && page.title.replace(/_/g, ' ') === id.replace(/_/g, ' '));
      return commonsCandidate(page);
    }
    if (provider === 'openverse' && typeof id === 'string' && UUID.test(id)) {
      const data = await cache.cachedGet(OPENVERSE_API + id.toLowerCase() + '/', { ttl: DETAIL_TTL, headers: HEADERS, timeout: 6000 });
      if (!data || typeof data.id !== 'string' || data.id.toLowerCase() !== id.toLowerCase()) return null;
      return openverseCandidate(data);
    }
    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

module.exports = { searchCandidates, getCandidate };
