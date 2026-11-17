const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const cache = require('../lib/cache');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const rarity = require('../lib/rarity');
const { getGenerationHistory } = require('../lib/generation-history');
const { PLACEHOLDER_URL } = require('../lib/constants');

const chevrolet = 'Chevrolet';
const caprice = 'Caprice';
const police = 'Caprice Police Vehicle';
const wikiUrl = 'https://en.wikipedia.org/wiki/Chevrolet_Caprice';
const brochure1966 = 'https://xr793.com/wp-content/uploads/2017/08/1966-Chevrolet-Full-Line.pdf#page=2';
const brochure1971 = 'https://xr793.com/wp-content/uploads/2017/07/1971-Chevrolet-Caprice-Impala-Belair.pdf#page=2';
const brochure1977 = 'https://xr793.com/wp-content/uploads/2017/07/1977-Chevrolet-Caprice-Classic-Impala.pdf#page=2';
const guide1991 = 'https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1991-Chevrolet-Caprice.pdf#page=3';
const policeLaunch = 'https://www.prnewswire.com/news-releases/chevrolet-prepares-2011-caprice-police-patrol-vehicle-for-duty-99252209.html';
const policeSpecs = 'https://www.gmupfitter.com/wp-content/uploads/2021/05/Caprice-9C1-Specification-Guide-2017.pdf';

describe('Chevrolet Caprice generations', function() {
  it('matches all four U.S. year ranges and only the exact civilian listing', function() {
    const history = (years, model = caprice, make = chevrolet) =>
      getGenerationHistory({ make, model, model_years: years });
    const yearRanges = year => history([year]).generations.map(row => [row.firstYear, row.lastYear]);

    for (const year of [1966, 1970]) assert.deepEqual(yearRanges(year), [[1966, 1970]]);
    for (const year of [1971, 1976]) assert.deepEqual(yearRanges(year), [[1971, 1976]]);
    for (const year of [1977, 1990]) assert.deepEqual(yearRanges(year), [[1977, 1990]]);
    for (const year of [1991, 1996]) assert.deepEqual(yearRanges(year), [[1991, 1996]]);
    assert.equal(history([1965, 1997, 2011, '1969']), null);
    assert.equal(history([1969], police), null);
    assert.equal(history([1969], caprice, 'Other Make'), null);
    assert.equal(getGenerationHistory({ make: chevrolet, model: caprice, year_min: 1966, year_max: 1996 }), null);
  });

  it('renders the civilian generation guide and an independent sourced police overview', async function() {
    const originalGet = cache.cachedGet;
    const originalFacts = carinfo.getWikidataFacts;
    const originalFuel = carinfo.getFuelSpecs;
    const originalSafety = nhtsa.getSafetyRatings;
    const originalComplaints = nhtsa.getComplaints;
    const originalRarity = rarity.getCarRarity;
    const carIds = [];
    const wikiRequests = [];
    try {
      cache.cachedGet = async url => {
        wikiRequests.push(url);
        return {
          type: 'standard', extract: 'Existing Caprice overview.', wikibase_item: 'Q1',
          content_urls: { desktop: { page: wikiUrl } }
        };
      };
      carinfo.getWikidataFacts = async () => [{ label: 'Produced', values: ['1965–1996'] }];
      carinfo.getFuelSpecs = async () => null;
      nhtsa.getSafetyRatings = async () => null;
      nhtsa.getComplaints = async () => null;
      rarity.getCarRarity = async () => null;

      for (const [model, years] of [[caprice, [1966, 1969, 1971, 1973, 1976, 1977, 1990, 1991, 1996]], [police, [2011, 2017]]]) {
        const car = await db.car.create({
          make: chevrolet, model, model_years: years, year_min: years[0], year_max: years.at(-1),
          image: PLACEHOLDER_URL, vehicle_type: 'car'
        });
        carIds.push(car.id);
      }

      const res = await request(app).get('/cars/car').query({ make: chevrolet, model: caprice }).expect(200);
      const guide = res.text.match(/<section[^>]+aria-labelledby="generation-references">([\s\S]*?)<\/section>/)?.[1];
      assert.ok(guide, 'missing generation guide');
      assert.match(guide, /<h3[^>]*>Caprice generations<\/h3>/);
      assert.match(guide, /U\.S\. model years/);
      assert.deepEqual([...guide.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1]), [
        '1966–1970', '1971–1976', '1977–1990', '1991–1996'
      ]);
      assert.match(guide, /option on the 1965 Impala Sport Sedan/);
      assert.match(guide, /1973[^<]*Caprice Classic name/);
      assert.ok(guide.includes(`href="${brochure1966}"`));
      assert.ok(guide.includes(`href="${brochure1971}"`));
      assert.match(guide, /1977–1990[\s\S]*?shorter full-size Caprice Classic/);
      assert.match(guide, /1991–1996[\s\S]*?rounder body for 1991[\s\S]*?sedans and wagons/);
      assert.ok(guide.includes(`href="${brochure1977}"`));
      assert.ok(guide.includes(`href="${guide1991}"`));
      assert.match(res.text, /Existing Caprice overview\./);
      assert.ok(res.text.includes(`href="${wikiUrl}"`));
      assert.match(res.text, /<dt>Produced<\/dt>/);

      const policePage = await request(app).get('/cars/car').query({ make: chevrolet, model: police }).expect(200);
      const overview = policePage.text.match(/<p class="lead"[^>]*>(Chevrolet offered the Caprice Police Patrol Vehicle,[^<]*2011–2017\.)<\/p>/)?.[1];
      assert.ok(overview, 'missing police overview');
      for (const meta of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
        assert.ok(policePage.text.includes(`<meta ${meta} content="${overview}">`), meta);
      }
      assert.ok(policePage.text.includes(`href="${policeLaunch}"`));
      assert.ok(policePage.text.includes(`href="${policeSpecs}"`));
      assert.ok(!policePage.text.includes(`href="${wikiUrl}"`));
      assert.doesNotMatch(policePage.text, /Caprice generations|Existing Caprice overview|1965–1996/);

      const comparison = await request(app).get('/cars/compare').query({ c: `${chevrolet}|${police}` }).expect(200);
      assert.doesNotMatch(comparison.text, /1965–1996/);
      assert.deepEqual(wikiRequests, ['https://en.wikipedia.org/api/rest_v1/page/summary/Chevrolet_Caprice']);
    } finally {
      cache.cachedGet = originalGet;
      carinfo.getWikidataFacts = originalFacts;
      carinfo.getFuelSpecs = originalFuel;
      nhtsa.getSafetyRatings = originalSafety;
      nhtsa.getComplaints = originalComplaints;
      rarity.getCarRarity = originalRarity;
      if (carIds.length) await db.car.destroy({ where: { id: carIds } });
    }
  });
});
