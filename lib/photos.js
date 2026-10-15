// Photo helpers shared by pages: the credit line under a catalog photo
// (views/partials/photo-credit.ejs) and smaller sizes of a stored photo.
const wikimedia = require('./wikimedia');
const { PLACEHOLDER_URL } = require('./constants');
const { isRetiredPhoto, displayPhoto } = require('./photoPolicy');

// Attribution for a displayed photo, or null.
//  - Wikimedia Commons: author, license and the file page. linkSource: false
//    leaves out the file page link, whose name gives the car away (the quiz).
function photoCredit(url, galleryRow, { linkSource = true } = {}) {
  if (!url || url === PLACEHOLDER_URL || isRetiredPhoto(url) || (galleryRow && galleryRow.source === 'unsplash')) return null;
  if (galleryRow && galleryRow.source === 'wikimedia') {
    return {
      name: galleryRow.credit_name || null,
      url: linkSource ? galleryRow.credit_url || null : null,
      license: galleryRow.license || null,
      licenseUrl: galleryRow.license_url || null,
      commons: true
    };
  }
  if (galleryRow && galleryRow.credit_name) {
    return {
      name: galleryRow.credit_name,
      url: linkSource ? galleryRow.credit_url || null : null,
      license: galleryRow.license || null,
      licenseUrl: galleryRow.license_url || null,
      source: galleryRow.source || null,
      commons: false
    };
  }
  if (galleryRow && galleryRow.license) {
    return {
      name: null, url: linkSource ? galleryRow.credit_url || null : null,
      license: galleryRow.license, licenseUrl: galleryRow.license_url || null,
      source: galleryRow.source || null, commons: false
    };
  }
  return null;
}

function sizedPhoto(url, width) {
  return wikimedia.sizedPhoto(displayPhoto(url), width);
}

// Card-sized version of a catalog photo (views use it as cardPhoto())
function cardPhoto(url) {
  return sizedPhoto(url, wikimedia.CARD_WIDTH);
}

// JSON's quoted string is also a CSS string. EJS must still HTML-escape the
// result when it is used in a style attribute. The second layer stays visible
// if an external photo cannot load, including before JavaScript is available.
function photoBackground(url) {
  url = displayPhoto(url);
  const fallback = `url(${JSON.stringify(PLACEHOLDER_URL)})`;
  return url && url !== PLACEHOLDER_URL
    ? `url(${JSON.stringify(url)}), ${fallback}`
    : fallback;
}

// The photo a favorite card shows: the user's own pick, else the car's current
// catalog photo (a car favorited before it had one picks it up later), else
// the placeholder. Expects the favorite with its car included.
function favoritePhoto(fav) {
  const own = displayPhoto(fav.image);
  if (own !== PLACEHOLDER_URL) return own;
  return displayPhoto(fav.car && fav.car.image);
}

module.exports = { photoCredit, cardPhoto, sizedPhoto, favoritePhoto, photoBackground, displayPhoto };
