// Unsplash is retired as a vehicle-photo source: attractive search results
// did not reliably depict the catalog model. Keep stored history, but never
// display or select those URLs again.
const { PLACEHOLDER_URL } = require('./constants');

// PostgreSQL's case-insensitive URL predicate mirrors the hostname check
// below. Used before pagination/selection, rather than filtering a full page.
const RETIRED_PHOTO_PATTERN = '^[[:space:]]*(https?:)?//([^/?#@]*@)?([^/?#.:]+\\.)*unsplash\\.com\\.?([:/?#]|$)';

function isRetiredPhoto(value) {
  if (typeof value !== 'string') return false;
  try {
    const hostname = new URL(value.trim(), 'https://autodx.io').hostname.toLowerCase().replace(/\.$/, '');
    return hostname === 'unsplash.com' || hostname.endsWith('.unsplash.com');
  } catch (err) {
    return false;
  }
}

function displayPhoto(value) {
  return !value || isRetiredPhoto(value) ? PLACEHOLDER_URL : value;
}

module.exports = { isRetiredPhoto, displayPhoto, RETIRED_PHOTO_PATTERN };
