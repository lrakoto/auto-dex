// Unsplash API helpers, following the API guidelines
// (help.unsplash.com → "Unsplash API Guidelines"):
//  - hotlink the returned photo.urls (we do; sized down, see sizedUrl)
//  - ping photo.links.download_location when a photo is actually used
//  - credit the photographer + Unsplash, with utm_source/utm_medium on links
const axios = require('axios');

const API = 'https://api.unsplash.com/';
const UTM = 'utm_source=autodex&utm_medium=referral';
const UNSPLASH_HOME = `https://unsplash.com/?${UTM}`;

function accessKey() {
  return process.env.UKEY;
}

function withUtm(link) {
  if (!link) return null;
  return link + (link.includes('?') ? '&' : '?') + UTM;
}

// urls.full is the original upload (often 4MB+). Unsplash URLs are imgix, so
// the same hotlink can be served at display size — w=1080 is ~25x smaller.
function sizedUrl(url, width = 1080) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'images.unsplash.com') return url;
    u.searchParams.set('w', String(width));
    u.searchParams.set('fit', 'max');
    u.searchParams.set('q', '80');
    u.searchParams.set('auto', 'format');
    return u.toString();
  } catch (e) {
    return url;
  }
}

function isUnsplashUrl(url) {
  try { return new URL(url).hostname === 'images.unsplash.com'; } catch (e) { return false; }
}

// Same photo regardless of size params — compare on the path (photo-<id>)
function samePhoto(a, b) {
  try { return new URL(a).pathname === new URL(b).pathname; } catch (e) { return false; }
}

function creditFor(photo) {
  const user = photo && photo.user;
  if (!user || !user.name) return { creditName: null, creditUrl: null };
  return { creditName: user.name, creditUrl: withUtm(user.links && user.links.html) };
}

// Top landscape search result for a car, or null
async function searchCarPhoto(make, model) {
  const res = await axios.get(`${API}search/photos`, {
    params: { query: `${make} ${model}`, orientation: 'landscape', page: 1, per_page: 1, client_id: accessKey() },
    timeout: 8000
  });
  const results = res.data && res.data.results;
  return results && results.length ? results[0] : null;
}

// Required by the guidelines when a photo is used; failures are non-fatal
async function trackDownload(photo) {
  const link = photo && photo.links && photo.links.download_location;
  if (!link) return;
  try {
    await axios.get(link, { params: { client_id: accessKey() }, timeout: 5000 });
  } catch (e) {
    console.log('Unsplash download tracking failed:', e.message);
  }
}

module.exports = { sizedUrl, isUnsplashUrl, samePhoto, creditFor, searchCarPhoto, trackDownload, withUtm, UNSPLASH_HOME };
