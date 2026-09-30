// Photo helpers shared by pages: the credit line under a catalog photo
// (views/partials/photo-credit.ejs) and smaller sizes of a stored photo.
const { isUnsplashUrl } = require('./unsplash');
const { sizedPhoto, CARD_WIDTH } = require('./wikimedia');

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

module.exports = { photoCredit, cardPhoto, sizedPhoto };
