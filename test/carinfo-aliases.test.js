const assert = require('assert');
const cache = require('../lib/cache');
const wikimedia = require('../lib/wikimedia');
const carinfo = require('../lib/carinfo');

const mg3 = {
  type: 'standard', title: 'MG3 (automobile)', description: 'Supermini car',
  extract: 'The MG3 is a supermini car produced under the British MG marque.',
  wikibase_item: 'Q772854', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/MG3_(automobile)' } }
};
const mg4 = {
  type: 'standard', title: 'MG4 EV', description: 'Battery electric small family car',
  extract: 'The MG4 EV is a battery electric small family car produced under the MG marque.',
  wikibase_item: 'Q112964039', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/MG4_EV' } }
};
const gr86 = {
  type: 'standard', title: 'Toyota 86', description: 'Japanese sports car',
  extract: 'The Toyota 86 and Subaru BRZ are sports cars jointly developed by Toyota and Subaru.',
  wikibase_item: 'Q1138779', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Toyota_86' } }
};
const weapon = {
  type: 'standard', title: 'MG3', description: 'Machine gun', extract: 'An unrelated machine gun.',
  wikibase_item: 'Q999999', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/MG3' } }
};

describe('Vehicle article aliases', function() {
  let realGet;
  let realFindArticle;
  let requested;

  beforeEach(function() {
    realGet = cache.cachedGet;
    realFindArticle = wikimedia.findArticle;
    requested = [];
  });
  afterEach(function() {
    cache.cachedGet = realGet;
    wikimedia.findArticle = realFindArticle;
  });

  function summaries(pages) {
    cache.cachedGet = async url => {
      assert(url.includes('/page/summary/'), 'known aliases must not use generic search');
      const title = decodeURIComponent(url.split('/page/summary/')[1]).replace(/_/g, ' ');
      requested.push(title);
      const page = pages[title];
      if (page instanceof Error) throw page;
      if (!page) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      return page;
    };
  }

  function result(article) {
    return { summary: article.extract, url: article.content_urls.desktop.page, wikidataId: article.wikibase_item };
  }

  it('takes MG3 description, source and facts ID from the automobile article', async function() {
    summaries({ 'MG MG3': weapon, MG3: weapon, 'MG3 (automobile)': mg3 });
    assert.deepStrictEqual(await carinfo.getWikiSummary('MG', 'MG3'), result(mg3));
    assert.deepStrictEqual(requested, ['MG MG3', 'MG3 (automobile)']);
  });

  it('finds MG4 EV when the catalog-shaped title is missing', async function() {
    summaries({ 'MG4 EV': mg4 });
    assert.deepStrictEqual(await carinfo.getWikiSummary('MG', 'MG4'), result(mg4));
    assert.deepStrictEqual(requested, ['MG MG4', 'MG4 EV']);
  });

  it('keeps the canonical Toyota86 description and entity after the GR86 redirect', async function() {
    summaries({ 'Toyota GR86': gr86 });
    assert.deepStrictEqual(await carinfo.getWikiSummary('Toyota', 'GR86'), result(gr86));
    assert.deepStrictEqual(requested, ['Toyota GR86']);
  });

  it('does not fall back to bare MG3 when the automobile article is absent', async function() {
    summaries({ MG3: weapon });
    assert.strictEqual(await carinfo.getWikiSummary('MG', 'MG3'), null);
    assert.deepStrictEqual(requested, ['MG MG3', 'MG3 (automobile)']);
  });

  it('returns null for alias outages without trying generic titles', async function() {
    const offline = Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
    summaries({ 'MG MG3': offline, MG3: weapon });
    assert.strictEqual(await carinfo.getWikiSummary('MG', 'MG3'), null);
    assert.deepStrictEqual(requested, ['MG MG3']);
  });

  it('does not use a canonical title that now redirects to another article', async function() {
    summaries({ 'MG MG3': weapon, 'MG3 (automobile)': { ...mg3, title: 'MG3 race car' }, MG3: weapon });
    assert.strictEqual(await carinfo.getWikiSummary('MG', 'MG3'), null);
    assert.deepStrictEqual(requested, ['MG MG3', 'MG3 (automobile)']);
  });

  it('returns null when an otherwise matching canonical article has no extract', async function() {
    for (const extract of [undefined, '']) {
      summaries({ 'MG3 (automobile)': { ...mg3, extract }, MG3: weapon });
      assert.strictEqual(await carinfo.getWikiSummary('MG', 'MG3'), null);
    }
    assert(!requested.includes('MG3'), 'missing extract enabled an unrelated fallback');
  });

  it('does not accept a non-vehicle page even when its canonical title matches', async function() {
    summaries({ 'MG3 (automobile)': { ...weapon, title: mg3.title } });
    assert.strictEqual(await carinfo.getWikiSummary('MG', 'MG3'), null);
  });

  it('keeps existing general lookups for another make and a model suffix', async function() {
    wikimedia.findArticle = async () => { throw new Error('unrelated lookup used photo aliases'); };
    for (const [make, model] of [['Other', 'MG3'], ['MG', 'MG3 Cup'], ['Toyota', 'GR86 Cup'], ['Honda', 'Pilot']]) {
      const page = { ...mg3, title: `${make} ${model}`, extract: `Description for ${make} ${model}.` };
      summaries({ [`${make} ${model}`]: page });
      assert.deepStrictEqual(await carinfo.getWikiSummary(make, model), result(page));
    }
  });

  it('keeps the general bare-model fallback outside the exact alias list', async function() {
    const pilot = { ...mg3, title: 'Honda Pilot', extract: 'The Honda Pilot is an SUV.' };
    summaries({ Pilot: pilot });
    assert.deepStrictEqual(await carinfo.getWikiSummary('Honda', 'Pilot'), result(pilot));
    assert.deepStrictEqual(requested, ['Honda Pilot', 'Pilot']);
  });
});
