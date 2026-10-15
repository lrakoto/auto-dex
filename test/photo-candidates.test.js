const assert = require('assert');
const cache = require('../lib/cache');
const { searchCandidates, getCandidate } = require('../lib/photoCandidates');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const FILE = 'File:2025 Honda Pilot.jpg';
const ID = '4bc43a04-ef46-4544-a0c1-63c63f56e276';

function commons(overrides = {}, metadata = {}) {
  return {
    ns: 6, title: FILE,
    imageinfo: [{
      mime: 'image/jpeg', width: 1600, height: 1000,
      url: 'https://upload.wikimedia.org/wikipedia/commons/3/36/2025_Honda_Pilot.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:2025_Honda_Pilot.jpg',
      extmetadata: {
        Artist: { value: '<a href="https://example.com/artist">Sig &amp; Co</a>' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
        ...metadata
      },
      ...overrides
    }]
  };
}

function openverse(overrides = {}) {
  return {
    id: ID, title: 'Honda Pilot at a car show', width: 1800, height: 1200, filetype: 'jpg',
    url: 'https://live.staticflickr.com/123/pilot.jpg',
    thumbnail: 'https://api.openverse.org/v1/images/' + ID + '/thumb/',
    foreign_landing_url: 'https://www.flickr.com/photos/artist/123/',
    creator: 'Sam &amp; Co', license: 'by', license_version: '2.0',
    license_url: 'https://creativecommons.org/licenses/by/2.0/',
    mature: false, source: 'flickr', provider: 'flickr',
    ...overrides
  };
}

describe('Reviewed photo candidates', function() {
  let originalGet;
  let calls;

  function respond({ pages = [commons()], results = [openverse()], commonsError, openverseError } = {}) {
    cache.cachedGet = async (url, options) => {
      calls.push({ url, options });
      if (url === COMMONS_API) {
        if (commonsError) throw commonsError;
        return { query: { pages } };
      }
      if (openverseError) throw openverseError;
      return url === OPENVERSE_API ? { results } : results[0];
    };
  }

  before(function() { originalGet = cache.cachedGet; });
  beforeEach(function() { calls = []; });
  afterEach(function() { cache.cachedGet = originalGet; });

  it('queries both fixed providers with bounded requests and preserves reusable metadata', async function() {
    respond();
    const { candidates, errors } = await searchCandidates('Honda', 'Pilot');
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(candidates.length, 2);
    const wiki = candidates.find(candidate => candidate.provider === 'wikimedia');
    assert.strictEqual(wiki.id, FILE);
    assert.strictEqual(wiki.creditName, 'Sig & Co');
    assert.strictEqual(wiki.license, 'CC BY-SA 4.0');
    assert.strictEqual(wiki.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
    assert.strictEqual(wiki.sourceUrl, 'https://commons.wikimedia.org/wiki/File:2025_Honda_Pilot.jpg');
    assert.match(wiki.url, /\/1280px-2025_Honda_Pilot\.jpg$/);
    assert.match(wiki.previewUrl, /\/500px-2025_Honda_Pilot\.jpg$/);
    const ov = candidates.find(candidate => candidate.provider === 'openverse');
    assert.strictEqual(ov.id, ID);
    assert.strictEqual(ov.creditName, 'Sam & Co');
    assert.strictEqual(ov.sourceUrl, openverse().foreign_landing_url);
    assert.strictEqual(ov.previewUrl, openverse().thumbnail);
    assert.strictEqual(calls[0].options.params.gsrnamespace, 6);
    assert.strictEqual(calls[0].options.params.gsrlimit, 6);
    assert.strictEqual(calls[0].options.params.iiurlwidth, 500);
    assert.strictEqual(calls[1].options.params.page_size, 6);
    assert.strictEqual(calls[1].options.params.license, 'by,by-sa,cc0,pdm');
    assert.strictEqual(calls[1].options.params.q, 'Honda Pilot');
    assert.ok(calls.every(call => call.options.timeout <= 6000));
  });

  it('keeps successful results when one provider fails and identifies that provider', async function() {
    respond({ commonsError: new Error('timeout') });
    const first = await searchCandidates('Honda', 'Pilot');
    assert.deepStrictEqual(first.candidates.map(candidate => candidate.provider), ['openverse']);
    assert.deepStrictEqual(first.errors.map(error => error.provider), ['wikimedia']);
    assert.ok(!first.errors[0].message.includes('timeout'));
    respond({ openverseError: new Error('secret upstream detail') });
    const second = await searchCandidates('Honda', 'Pilot');
    assert.deepStrictEqual(second.candidates.map(candidate => candidate.provider), ['wikimedia']);
    assert.deepStrictEqual(second.errors.map(error => error.provider), ['openverse']);
  });

  it('reports both failures without confusing them with an empty successful search', async function() {
    respond({ commonsError: new Error('offline'), openverseError: new Error('offline') });
    const failed = await searchCandidates('Honda', 'Pilot');
    assert.strictEqual(failed.candidates.length, 0);
    assert.strictEqual(failed.errors.length, 2);
    cache.cachedGet = async url => url === COMMONS_API ? { batchcomplete: true } : { results: [] };
    assert.deepStrictEqual(await searchCandidates('Honda', 'Pilot'), { candidates: [], errors: [] });
  });

  it('treats malformed provider responses as failures', async function() {
    cache.cachedGet = async url => url === COMMONS_API ? { error: { code: 'search-error' } } : { results: {} };
    const result = await searchCandidates('Honda', 'Pilot');
    assert.strictEqual(result.errors.length, 2);
    assert.deepStrictEqual(result.candidates, []);
  });

  it('caps unexpected oversized provider responses and ranks matching titles ahead of generic titles', async function() {
    const generic = { ...commons(), title: 'File:Car at a show.jpg' };
    respond({ pages: Array.from({ length: 20 }, () => generic), results: Array.from({ length: 20 }, () => openverse()) });
    const { candidates } = await searchCandidates('Honda', 'Pilot');
    assert.strictEqual(candidates.length, 12);
    assert.strictEqual(candidates[0].provider, 'openverse');
    assert.ok(candidates.some(candidate => candidate.title === 'Car at a show.jpg'));
  });

  it('accepts supported raster formats and never upscales a smaller Commons original', async function() {
    respond({ pages: [commons({ mime: 'image/png', width: 1000, height: 600 })], results: [openverse({ filetype: 'webp' })] });
    const { candidates } = await searchCandidates('Honda', 'Pilot');
    assert.strictEqual(candidates.length, 2);
    assert.match(candidates[0].url, /\/960px-/);
  });

  it('supports real Openverse records with a null filetype and a validated raster media path', async function() {
    const record = openverse({
      id: '9a1a40e5-175d-41b3-93c2-9f6b9ba5f3e2', title: 'Honda Civic Si Showcar side shot',
      filetype: null, width: 1024, height: 768, license: 'by-sa', license_version: '2.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/2.0/', creator: 'darinmarshall',
      url: 'https://live.staticflickr.com/48/112100101_7ec63201ac_b.jpg',
      foreign_landing_url: 'https://www.flickr.com/photos/91655741@N00/112100101',
      thumbnail: 'https://api.openverse.org/v1/images/9a1a40e5-175d-41b3-93c2-9f6b9ba5f3e2/thumb/'
    });
    respond({ pages: [], results: [record] });
    const { candidates, errors } = await searchCandidates('Honda', 'Civic');
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].id, record.id);
    assert.strictEqual(candidates[0].url, record.url);
    assert.strictEqual(candidates[0].creditName, 'darinmarshall');
    assert.deepStrictEqual(await getCandidate('openverse', record.id, 'Honda', 'Civic'), candidates[0]);
  });

  it('never infers an unknown image path or overrides an explicit unsupported filetype', async function() {
    for (const overrides of [
      { filetype: null, url: 'https://example.com/image?format=jpg' },
      { filetype: null, url: 'https://example.com/car.jpg.svg' },
      { filetype: null, url: 'https://example.com/car.pdf' },
      { filetype: 'svg', url: 'https://example.com/car.jpg' },
      { filetype: 'pdf', url: 'https://example.com/car.jpg' }
    ]) {
      respond({ pages: [], results: [openverse(overrides)] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, []);
      assert.strictEqual(await getCandidate('openverse', ID, 'Honda', 'Pilot'), null);
    }
  });

  it('rejects small, portrait, square, vector and nonnumeric image dimensions', async function() {
    const bad = [
      { width: 639 }, { width: 1000, height: 1200 }, { width: 1000, height: 1000 },
      { width: '1800' }, { height: 0 }, { width: Infinity }
    ];
    for (const overrides of bad) {
      respond({ pages: [commons(overrides)], results: [openverse(overrides)] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, [], JSON.stringify(overrides));
    }
    respond({ pages: [commons({ mime: 'image/svg+xml' })], results: [openverse({ filetype: 'svg' })] });
    assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, []);
  });

  it('requires author, source page and known matching license metadata', async function() {
    for (const metadata of [
      { Artist: { value: ' ' } }, { LicenseShortName: { value: 'All rights reserved' } },
      { LicenseUrl: { value: 'https://example.com/cc-license' } },
      { LicenseShortName: { value: 'CC BY-NC 4.0' } },
      { LicenseShortName: { value: 'CC BY 4.0' } }
    ]) {
      respond({ pages: [commons({}, metadata)], results: [] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, []);
    }
    for (const overrides of [
      { creator: null }, { title: '' }, { foreign_landing_url: null }, { license: 'by-nc' },
      { license: 'by-nd' }, { license: 'unknown' }, { license_url: null },
      { license_url: 'https://creativecommons.org/licenses/by-sa/2.0/' }, { license_version: '4.0' }
    ]) {
      respond({ pages: [], results: [openverse(overrides)] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, [], JSON.stringify(overrides));
    }
  });

  it('accepts CC0 and public-domain records only with their matching official license URLs', async function() {
    for (const [code, label, link] of [
      ['cc0', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
      ['pdm', 'Public domain', 'https://creativecommons.org/publicdomain/mark/1.0/']
    ]) {
      respond({
        pages: [commons({}, { LicenseShortName: { value: label }, LicenseUrl: { value: link } })],
        results: [openverse({ license: code, license_version: '1.0', license_url: link })]
      });
      const { candidates } = await searchCandidates('Honda', 'Pilot');
      assert.strictEqual(candidates.length, 2);
      assert.ok(candidates.every(candidate => candidate.license === label && candidate.licenseUrl === link));
    }
  });

  it('rejects unsafe media/source URLs and falls back safely from an unsafe thumbnail', async function() {
    for (const url of [
      'javascript:alert(1)', 'data:image/jpeg;base64,x', '//cdn.example.com/pilot.jpg',
      'https://user:password@example.com/pilot.jpg', 'https://example.com\\@evil.test/pilot.jpg',
      'https://localhost/pilot.jpg', 'https://example.com/white space.jpg',
      'https://127.0.0.1/pilot.jpg', 'https://192.168.1.1/pilot.jpg', 'https://2130706433/pilot.jpg',
      'https://[::1]/pilot.jpg', 'https://[::ffff:127.0.0.1]/pilot.jpg', 'https://[2001:db8::1]/pilot.jpg'
    ]) {
      respond({ pages: [], results: [openverse({ url })] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, [], url);
      respond({ pages: [], results: [openverse({ foreign_landing_url: url })] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, [], url);
    }
    respond({ pages: [], results: [openverse({ thumbnail: 'javascript:alert(1)' })] });
    const [candidate] = (await searchCandidates('Honda', 'Pilot')).candidates;
    assert.strictEqual(candidate.previewUrl, candidate.url);
  });

  it('requires HTTPS images for the production CSP while permitting HTTP source pages', async function() {
    respond({ pages: [commons({ url: 'http://upload.wikimedia.org/wikipedia/commons/3/36/2025_Honda_Pilot.jpg' })], results: [openverse({ url: 'http://live.staticflickr.com/123/pilot.jpg' })] });
    assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, []);
    respond({ pages: [], results: [openverse({
      thumbnail: 'http://api.openverse.org/v1/images/' + ID + '/thumb/',
      foreign_landing_url: 'http://www.flickr.com/photos/artist/123/'
    })] });
    const [candidate] = (await searchCandidates('Honda', 'Pilot')).candidates;
    assert.strictEqual(candidate.previewUrl, candidate.url);
    assert.strictEqual(candidate.sourceUrl, 'http://www.flickr.com/photos/artist/123/');
    assert.ok(candidate.url.startsWith('https://'));
  });

  it('rejects all Unsplash-backed media, source links and providers', async function() {
    for (const overrides of [
      { url: 'https://images.unsplash.com/photo-1' }, { url: 'https://plus.unsplash.com/premium-1' },
      { foreign_landing_url: 'https://unsplash.com/photos/1' }, { source: 'unsplash' }, { provider: 'Unsplash' }
    ]) {
      respond({ pages: [], results: [openverse(overrides)] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, [], JSON.stringify(overrides));
    }
    respond({ pages: [], results: [openverse({ thumbnail: 'https://images.unsplash.com/photo-1' })] });
    const [candidate] = (await searchCandidates('Honda', 'Pilot')).candidates;
    assert.strictEqual(candidate.previewUrl, candidate.url);
    assert.ok(!JSON.stringify(candidate).includes('unsplash'));
  });

  it('rejects mature Openverse records and Commons records outside the trusted file namespace/host', async function() {
    for (const page of [
      { ...commons(), ns: 0 }, { ...commons(), missing: true },
      { ...commons(), title: 'File:Not a raster.svg' },
      commons({ url: 'https://example.com/wikipedia/commons/3/36/Pilot.jpg' }),
      commons({ descriptionurl: 'https://example.com/wiki/File:Pilot.jpg' })
    ]) {
      respond({ pages: [page], results: [openverse({ mature: true })] });
      assert.deepStrictEqual((await searchCandidates('Honda', 'Pilot')).candidates, []);
    }
  });

  it('re-resolves a Commons ID through imageinfo rather than trusting submitted URLs or credits', async function() {
    respond();
    const candidate = await getCandidate('wikimedia', FILE, 'Honda', 'Pilot');
    assert.strictEqual(candidate.creditName, 'Sig & Co');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, COMMONS_API);
    assert.strictEqual(calls[0].options.params.titles, FILE);
    assert.ok(!calls[0].options.params.gsrsearch);
    respond({ pages: [commons({}, { LicenseShortName: { value: 'All rights reserved' } })] });
    assert.strictEqual(await getCandidate('wikimedia', FILE, 'Honda', 'Pilot'), null);
  });

  it('re-resolves only the requested Openverse UUID through its fixed detail endpoint', async function() {
    respond();
    const candidate = await getCandidate('openverse', ID.toUpperCase(), 'Honda', 'Pilot');
    assert.strictEqual(candidate.id, ID);
    assert.strictEqual(calls[0].url, OPENVERSE_API + ID + '/');
    respond({ results: [openverse({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })] });
    assert.strictEqual(await getCandidate('openverse', ID, 'Honda', 'Pilot'), null);
  });

  it('rejects arbitrary approval URLs, namespace injection and invalid context before any upstream request', async function() {
    respond();
    for (const [provider, id] of [
      ['google', ID], ['openverse', 'https://example.com/image'], ['openverse', ID + '/related'],
      ['wikimedia', 'https://example.com/file.jpg'], ['wikimedia', FILE + '|File:Another.jpg'],
      ['wikimedia', 'File:Bad\nName.jpg'], ['wikimedia', 'File:' + 'a'.repeat(513) + '.jpg']
    ]) assert.strictEqual(await getCandidate(provider, id, 'Honda', 'Pilot'), null);
    assert.strictEqual(await getCandidate('openverse', ID, '', 'Pilot'), null);
    assert.deepStrictEqual(await searchCandidates('Honda', ''), { candidates: [], errors: [] });
    assert.strictEqual(calls.length, 0);
  });

  it('returns null for missing candidates but propagates an upstream outage for the approval route', async function() {
    const missing = Object.assign(new Error('not found'), { response: { status: 404 } });
    respond({ commonsError: missing, openverseError: missing });
    assert.strictEqual(await getCandidate('wikimedia', FILE, 'Honda', 'Pilot'), null);
    assert.strictEqual(await getCandidate('openverse', ID, 'Honda', 'Pilot'), null);
    respond({ pages: [{ ns: 6, title: FILE, missing: true }] });
    assert.strictEqual(await getCandidate('wikimedia', FILE, 'Honda', 'Pilot'), null);
    respond({ openverseError: new Error('provider outage') });
    await assert.rejects(getCandidate('openverse', ID, 'Honda', 'Pilot'), /provider outage/);
  });
});
