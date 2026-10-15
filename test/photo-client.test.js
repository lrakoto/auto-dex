const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '../public/js/photos.js');
const source = readFileSync(scriptPath, 'utf8');
const base = 'https://autodex.example/';
const placeholder = '/assets/no-photo.svg';

function image(src, extra = {}) {
  const attrs = { src, ...extra.attrs };
  const changes = [];
  const img = {
    tagName: 'IMG', id: '', dataset: {}, style: {}, complete: true, naturalWidth: 0,
    ...extra,
    getAttribute(name) { return attrs[name] || null; },
    hasAttribute(name) { return Object.hasOwn(attrs, name); },
    removeAttribute(name) { delete attrs[name]; },
    get src() { return new URL(attrs.src, base).href; },
    set src(value) { attrs.src = value; changes.push(value); }
  };
  return { img, attrs, changes };
}

function loadPhotos(images = [], readyState = 'loading') {
  const listeners = {};
  const window = { location: { href: base } };
  const document = {
    images, readyState,
    addEventListener(name, listener, options) {
      listeners[name] = { listener, options };
    }
  };
  vm.runInNewContext(source, { URL, window, document }, { filename: scriptPath });
  return {
    photos: window.AutoDexPhotos,
    error(target) { listeners.error.listener({ target }); },
    loaded() { listeners.DOMContentLoaded.listener(); },
    listeners
  };
}

describe('Browser photo handling', function() {
  it('repairs old Unsplash separators and bounds small cards without losing source parameters', function() {
    const { photos } = loadPhotos();
    const result = new URL(photos.cardPhoto('https://images.unsplash.com/photo-car?ixid=source&amp;ixlib=rb-4.0&amp;w=7890&amp;q=100'));
    assert.equal(result.searchParams.get('ixid'), 'source');
    assert.equal(result.searchParams.get('ixlib'), 'rb-4.0');
    assert.equal(result.searchParams.get('w'), '500');
    assert.equal(result.searchParams.get('fit'), 'max');
    assert.equal(result.searchParams.get('q'), '80');
    assert.equal(result.searchParams.get('auto'), 'format');
    assert.ok(!result.search.includes('amp%3B'));
  });

  it('shrinks Commons thumbnails on both hosts without upscaling or changing originals', function() {
    const { photos } = loadPhotos();
    for (const host of ['upload.wikimedia.org', 'thumb.wikimedia.org']) {
      const prefix = `https://${host}/wikipedia/commons/thumb/a/ab/Car_%28front%29.jpg/`;
      assert.equal(photos.cardPhoto(prefix + '1280px-Car_%28front%29.jpg?x=1&amp;y=2'), prefix + '500px-Car_%28front%29.jpg?x=1&y=2');
      assert.equal(photos.cardPhoto(prefix + '330px-Car_%28front%29.jpg'), prefix + '330px-Car_%28front%29.jpg');
    }
    const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Car.jpg';
    assert.equal(photos.cardPhoto(original), original);
  });

  it('keeps other image hosts intact and rejects unsafe or missing URLs', function() {
    const { photos } = loadPhotos();
    const other = 'https://example.com/car.jpg?one=1&amp;two=2';
    assert.equal(photos.cardPhoto(other), other);
    assert.equal(photos.cardPhoto(placeholder), placeholder);
    for (const value of [null, undefined, '', 'not a URL', '//example.com/car.jpg', 'javascript:alert(1)', 'data:image/svg+xml,photo', 'https://[invalid', 'https://example.com/\ncar.jpg']) {
      assert.equal(photos.cardPhoto(value), placeholder, String(value));
    }
  });

  it('catches initial failures after parsing while leaving loaded and deferred lazy photos alone', function() {
    const failed = image('/missing.jpg');
    const loaded = image('/loaded.jpg', { naturalWidth: 500 });
    const lazy = image('/lazy.jpg', { complete: false, attrs: { loading: 'lazy' } });
    const empty = image('');
    const context = loadPhotos([failed.img, loaded.img, lazy.img, empty.img]);
    assert.equal(context.listeners.error.options, true);
    assert.deepEqual(failed.changes, []);
    context.loaded();
    assert.deepEqual(failed.changes, [placeholder]);
    assert.deepEqual(loaded.changes, []);
    assert.deepEqual(lazy.changes, []);
    assert.deepEqual(empty.changes, []);
  });

  it('recovers dynamic failures once and cannot loop when the local fallback fails', function() {
    const failed = image('/missing.jpg', { attrs: { srcset: '/missing-large.jpg 2x' } });
    const context = loadPhotos();
    context.error(failed.img);
    context.error(failed.img);
    assert.deepEqual(failed.changes, [placeholder]);
    assert.equal(failed.attrs.srcset, undefined);
    const alreadyFallback = image(placeholder);
    context.error(alreadyFallback.img);
    assert.deepEqual(alreadyFallback.changes, []);
  });

  it('honors explicit hiding and fallback choices but leaves the mystery quiz to its own handler', function() {
    const hidden = image('/missing-logo.jpg', { attrs: { 'data-onerror-hide': '' } });
    const custom = image('/missing.jpg', { dataset: { onerrorFallback: '/assets/custom.jpg' } });
    const invalid = image('/missing.jpg', { dataset: { onerrorFallback: 'javascript:alert(1)' } });
    const quiz = image('/missing-quiz.jpg', { id: 'play-img' });
    const context = loadPhotos();
    for (const candidate of [hidden, custom, invalid, quiz]) context.error(candidate.img);
    assert.equal(hidden.img.style.display, 'none');
    assert.deepEqual(hidden.changes, []);
    assert.deepEqual(custom.changes, ['/assets/custom.jpg']);
    assert.deepEqual(invalid.changes, [placeholder]);
    assert.deepEqual(quiz.changes, []);
    context.error({ tagName: 'SCRIPT' });
  });

  it('also recovers failures when loaded after the document is ready', function() {
    const failed = image('/missing.jpg');
    loadPhotos([failed.img], 'complete');
    assert.deepEqual(failed.changes, [placeholder]);
  });
});
