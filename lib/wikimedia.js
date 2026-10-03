// Photos from Wikipedia (R2): the lead image of a car's Wikipedia article,
// with author and license from Wikimedia Commons. Only Commons files are used:
// images uploaded to English Wikipedia itself are mostly non-free (fair use)
// and can't be reused here. Lookups go through lib/cache.js; a lookup that
// fails (as opposed to finding nothing) throws, so the job can retry it.
const cache = require('./cache'); // via the module so tests can stub it

const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'AutoDex/1.0 (https://github.com/lrakoto/auto-dex)' };
const FILE_INFO_TTL = 30 * 24 * 60 * 60 * 1000;

// Wikimedia only renders thumbnails at these widths; others return HTTP 400
const STANDARD_WIDTHS = [250, 330, 500, 960, 1280, 1920, 3840];
const HERO_WIDTH = 1280;
const CARD_WIDTH = 500;
const MIN_WIDTH = 640; // smaller originals look soft as a hero

const VEHICLE_WORDS = /\b(cars?|automobiles?|vehicles?|suvs?|crossovers?|sedans?|saloons?|hatchbacks?|coup[eé]s?|convertibles?|roadsters?|wagons?|minivans?|mpvs?|vans?|pickups?|pick-ups?|trucks?|motorcycles?|motorbikes?|scooters?|mopeds?|supercars?|buses|tractors?)\b/i;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The article title names the make, then the model: every word of it, or the
// model right after the make with spacing ignored up to a word boundary
// ("Cadillac de Ville series" for "Deville", "Kawasaki GPZ305" for "GPZ 305",
// but not "BMW R1200GS" for "R 12"). Mercedes "EQB-Class" is titled
// "Mercedes-Benz EQB", so "-Class" is optional.
function titleMatches(title, make, model) {
  const t = norm(title);
  const m = norm(make);
  if (!` ${t} `.includes(` ${m} `)) return false;
  const words = norm(model.replace(/-Class$/i, '')).split(' ').filter(Boolean);
  if (!words.length) return false;
  if (words.every(w => ` ${t} `.includes(` ${w} `))) return true;
  const rest = t.startsWith(m + ' ') ? t.slice(m.length + 1) : null;
  const letters = words.join('').split('');
  return rest !== null && new RegExp(`^${letters.join(' ?')}( |$)`).test(rest);
}

// A search result has to be the model itself, not a variant ("BMW M8" must
// not become "BMW M8 GTE"): the title, less a "(…)" qualifier, is make and
// model with spacing ignored
function sameName(title, make, model) {
  const compact = s => norm(s).replace(/ /g, '');
  return compact(String(title).replace(/\s*\([^)]*\)\s*$/, '')) === compact(`${make} ${model.replace(/-Class$/i, '')}`);
}

// ...and the article is about a vehicle, not a person or place of that name
function articleMatches(summary, make, model) {
  if (!summary || !titleMatches(summary.title, make, model)) return false;
  return VEHICLE_WORDS.test(`${summary.description || ''} ${String(summary.extract || '').slice(0, 300)}`);
}

// Trim-level names that have no article of their own and live in their
// series' article instead: BMW "525i" and "M235i" in "BMW 5 Series" and "BMW
// 2 Series", Infiniti "G35" in "Infiniti G Line", Audi "A8 L" in "Audi A8".
// Returns the series as it reads in that article's title, or null. Infiniti
// EX is left out on purpose: its article is now the QX50, a different car.
//
// A series article leads with its current generation, so it only suits a trim
// still on sale: a 1985 BMW 633CSi would get a 2018 6 Series GT. Trims whose
// last model year is older (or unknown) keep waiting for a better photo.
const SERIES_RECENT_YEARS = 2;
const INFINITI_SERIES = { FX: 'QX70', G: 'G Line', M: 'M' };
const SERIES = {
  BMW: model => {
    const m = model.match(/^M?([1-8])\d\d(?!\d)/) || model.match(/^ActiveHybrid ([357])$/);
    return m ? `${m[1]} Series` : null;
  },
  Infiniti: model => {
    const m = model.match(/^(FX|G|M)\d\d[a-z]?$/);
    return m ? INFINITI_SERIES[m[1]] : null;
  },
  Audi: model => {
    const m = model.match(/^((?:A|S|RS|Q|SQ) ?\d) .+$/);
    return m ? m[1] : null;
  }
};

function seriesOf(make, model) {
  return SERIES[make] ? SERIES[make](String(model)) : null;
}

// REST summary for a title (redirects followed), or null when there's no such
// article. Same URL as lib/carinfo.js, so both share the cache entry.
async function summary(title) {
  try {
    const data = await cache.cachedGet(WIKI_SUMMARY + encodeURIComponent(title.replace(/\s+/g, '_')), { timeout: 4000, headers: HEADERS });
    return data && data.type === 'standard' ? data : null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

// The Wikipedia article about this make and model, or null. yearMax (the
// car's last model year) lets a current trim fall back to its series article.
async function findArticle(make, model, { yearMax } = {}) {
  const titles = [`${make} ${model}`];
  if (/-Class$/i.test(model)) titles.push(`${make} ${model.replace(/-Class$/i, '')}`);
  for (const title of titles) {
    const hit = await summary(title);
    if (articleMatches(hit, make, model)) return hit;
  }
  // Search, fetching only results named exactly for the model
  let found = null;
  try {
    found = await cache.cachedGet(WIKI_API, {
      params: { action: 'opensearch', search: `${make} ${model}`, limit: 5, namespace: 0, format: 'json' },
      timeout: 4000,
      headers: HEADERS
    });
  } catch (err) {
    if (!(err.response && err.response.status === 404)) throw err;
  }
  for (const title of (found && found[1]) || []) {
    if (titles.includes(title) || !sameName(title, make, model)) continue;
    const hit = await summary(title);
    if (articleMatches(hit, make, model)) return hit;
  }
  // Last, a trim's series article, matched against the series name
  const series = seriesOf(make, model);
  if (series && yearMax >= new Date().getFullYear() - SERIES_RECENT_YEARS) {
    const hit = await summary(`${make} ${series}`);
    if (articleMatches(hit, make, series)) return hit;
  }
  return null;
}

// The Commons file behind an upload or thumbnail URL:
// { hash: 'b/b0', file: 'Name.jpg' } (file stays URL-encoded), or null
function commonsFile(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)wikimedia\.org$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/wikipedia\/commons\/(?:thumb\/)?([0-9a-f]\/[0-9a-f]{2})\/([^/]+)/);
    return m ? { hash: m[1], file: m[2] } : null;
  } catch (e) {
    return null;
  }
}

// Largest standard width up to `want` that doesn't upscale the original
function fitWidth(want, originalWidth) {
  const fits = STANDARD_WIDTHS.filter(w => w <= want && w <= originalWidth);
  return fits.length ? fits[fits.length - 1] : null;
}

function thumbUrl({ hash, file }, width) {
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${hash}/${file}/${width}px-${file}`;
}

const THUMB = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/(\d+)px-\2$/;

// A stored Commons thumbnail at a smaller standard width (cards, thumbnails).
// Anything else, or a width the thumbnail can't shrink to, comes back as is.
function sizedPhoto(url, width) {
  const m = typeof url === 'string' && url.match(THUMB);
  if (!m || !STANDARD_WIDTHS.includes(width) || Number(m[3]) <= width) return url;
  return `${m[1]}/${width}px-${m[2]}`;
}

// Commons credit fields are HTML ("<a href=…>Name</a>"); the page escapes
// whatever we store, so keep plain text
function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
    .slice(0, 120);
}

// Size, type, author and license of a Commons file, or null if Commons
// doesn't have it
async function fileInfo(fileName) {
  const data = await cache.cachedGet(COMMONS_API, {
    params: {
      action: 'query', format: 'json', formatversion: 2, prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
      titles: `File:${fileName}`
    },
    ttl: FILE_INFO_TTL,
    timeout: 6000,
    headers: HEADERS
  });
  const page = data && data.query && data.query.pages && data.query.pages[0];
  const info = page && !page.missing && page.imageinfo && page.imageinfo[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const value = key => (meta[key] && meta[key].value) || null;
  return {
    mime: info.mime,
    width: info.width,
    height: info.height,
    pageUrl: info.descriptionurl || null,
    artist: plainText(value('Artist')) || null,
    license: plainText(value('LicenseShortName')) || null,
    licenseUrl: value('LicenseUrl')
  };
}

// The lead photo of a catalog car's Wikipedia article, ready for the gallery:
// { url, creditName, creditUrl, license, licenseUrl, article } — or null when
// there's no matching article, no photo, or the photo doesn't suit (not on
// Commons, not a JPEG, portrait, or small).
async function findLeadPhoto(make, model, { yearMax } = {}) {
  const article = await findArticle(make, model, { yearMax });
  const file = article && article.originalimage && commonsFile(article.originalimage.source);
  if (!file) return null;
  let fileName;
  try { fileName = decodeURIComponent(file.file); } catch (e) { return null; }
  const info = await fileInfo(fileName);
  if (!info || info.mime !== 'image/jpeg' || info.width < MIN_WIDTH || info.width < info.height) return null;
  return {
    url: thumbUrl(file, fitWidth(HERO_WIDTH, info.width)),
    creditName: info.artist,
    creditUrl: info.pageUrl,
    license: info.license,
    licenseUrl: info.licenseUrl,
    article: article.title
  };
}

module.exports = {
  findLeadPhoto, findArticle, seriesOf, articleMatches, titleMatches, sameName, commonsFile, fitWidth, thumbUrl, sizedPhoto, plainText,
  STANDARD_WIDTHS, HERO_WIDTH, CARD_WIDTH
};
