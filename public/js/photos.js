(function () {
  'use strict';

  var PLACEHOLDER = '/assets/no-photo.svg';
  var attempted = new WeakSet();

  function imageUrl(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
    var raw = value.trim();
    if (!/^https?:\/\//i.test(raw) && !/^\/(?!\/)/.test(raw)) return null;
    try {
      var url = new URL(raw, window.location.href);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      // Before the CSP-safe data attributes, recently viewed URLs were written
      // into inline JavaScript with HTML-escaped query separators.
      if (url.hostname === 'images.unsplash.com' || url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') {
        url = new URL(raw.replace(/&amp;/g, '&'), window.location.href);
      }
      return { url: url, relative: raw.charAt(0) === '/' };
    } catch (err) {
      return null;
    }
  }

  function formatUrl(parsed) {
    return parsed.relative ? parsed.url.pathname + parsed.url.search + parsed.url.hash : parsed.url.href;
  }

  function cardPhoto(value) {
    var parsed = imageUrl(value);
    if (!parsed) return PLACEHOLDER;
    var url = parsed.url;
    if (url.hostname === 'images.unsplash.com') {
      url.searchParams.set('w', '500');
      url.searchParams.set('fit', 'max');
      url.searchParams.set('q', '80');
      url.searchParams.set('auto', 'format');
    } else if (url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') {
      var thumb = url.pathname.match(/^(\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/(\d+)px-\2$/);
      if (thumb && Number(thumb[3]) > 500) url.pathname = thumb[1] + '/500px-' + thumb[2];
    }
    return formatUrl(parsed);
  }

  function failedImage(img) {
    if (!img || img.tagName !== 'IMG' || img.id === 'play-img' || attempted.has(img)) return;
    attempted.add(img);
    if (img.hasAttribute('data-onerror-hide')) {
      img.style.display = 'none';
      return;
    }
    var supplied = imageUrl(img.dataset.onerrorFallback);
    var fallback = supplied ? formatUrl(supplied) : PLACEHOLDER;
    // src is absolute even when the attribute is relative. Compare canonical
    // URLs and remember the attempt so a missing fallback cannot loop.
    if (img.src === new URL(fallback, window.location.href).href) return;
    img.removeAttribute('srcset');
    img.src = fallback;
  }

  // Capture also covers images added later by recently viewed/compare. Load
  // this script early; scan afterward for errors that happened before it ran.
  document.addEventListener('error', function (event) { failedImage(event.target); }, true);
  function scanFailedImages() {
    Array.prototype.forEach.call(document.images, function (img) {
      if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) failedImage(img);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanFailedImages, { once: true });
  else scanFailedImages();

  window.AutoDexPhotos = { cardPhoto: cardPhoto };
})();
