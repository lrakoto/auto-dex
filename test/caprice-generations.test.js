const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
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

  it('renders the four sourced rows on the civilian detail page alongside the overview', async function() {
    const originalWiki = carinfo.getWikiSummary;
    const originalFuel = carinfo.getFuelSpecs;
    const originalSafety = nhtsa.getSafetyRatings;
    const originalComplaints = nhtsa.getComplaints;
    const originalRarity = rarity.getCarRarity;
    const carIds = [];
    try {
      carinfo.getWikiSummary = async () => ({ summary: 'Existing Caprice overview.', url: wikiUrl });
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

      const policePage = await request(app).get('/cars/car').query({ make: chevrolet, model: police }).expect(200);
      assert.doesNotMatch(policePage.text, /Caprice generations|First standalone Caprice/);
    } finally {
      carinfo.getWikiSummary = originalWiki;
      carinfo.getFuelSpecs = originalFuel;
      nhtsa.getSafetyRatings = originalSafety;
      nhtsa.getComplaints = originalComplaints;
      rarity.getCarRarity = originalRarity;
      if (carIds.length) await db.car.destroy({ where: { id: carIds } });
    }
  });
});
