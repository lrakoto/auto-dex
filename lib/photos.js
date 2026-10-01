// Photo helpers shared by pages: the credit line under a catalog photo
// (views/partials/photo-credit.ejs) and smaller sizes of a stored photo.
const { isUnsplashUrl } = require('./unsplash');
const { sizedPhoto, CARD_WIDTH } = require('./wikimedia');
const { PLACEHOLDER_URL } = require('./constants');

// Attribution for a displayed photo, or null.
//  - Wikimedia Commons: author, license and the file page. linkSource: false
//    leaves out the file page link, whose name gives the car away (the quiz).
//  - Unsplash: the recorded photographer, else a generic Unsplash credit.
function photoCredit(url, galleryRow, { linkSource = true } = {}) {
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
    return { name: galleryRow.credit_name, url: galleryRow.credit_url, unsplash: isUnsplashUrl(url) };
  }
  if (isUnsplashUrl(url)) return { name: null, url: null, unsplash: true };
  return null;
}

// Card-sized version of a catalog photo (views use it as cardPhoto())
function cardPhoto(url) {
  return sizedPhoto(url, CARD_WIDTH);
}

// The photo a favorite card shows: the user's own pick, else the car's current
// catalog photo (a car favorited before it had one picks it up later), else
// the placeholder. Expects the favorite with its car included.
function favoritePhoto(fav) {
  if (fav.image && fav.image !== PLACEHOLDER_URL) return fav.image;
  return (fav.car && fav.car.image) || PLACEHOLDER_URL;
}

module.exports = { photoCredit, cardPhoto, sizedPhoto, favoritePhoto };
