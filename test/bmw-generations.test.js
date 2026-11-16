const assert = require('node:assert/strict');
const { escapeXML } = require('ejs');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carinfo = require('../lib/carinfo');
const nhtsa = require('../lib/nhtsa');
const rarity = require('../lib/rarity');
const { getGenerationHistory } = require('../lib/bmw-generations');
const { PLACEHOLDER_URL } = require('../lib/constants');
const archive528iE12 = 'https://www.bmwgroup-classic.com/en/models/bmw-classics/product-description-page.ad-159-1.bmw-528i-e12.html';
const archive840ci = 'https://www.bmwgroup-classic.com/de/modelle/bmw-klassiker/product-description-page.ad-211-1.bmw-840ci-e31.html';

function history(model, years, make = 'BMW') {
  return getGenerationHistory({ make, model, model_years: years });
}

describe('BMW generation references', function() {
  it('matches exact catalog names and integer model years within the sourced cohorts', function() {
    assert.equal(getGenerationHistory(null), null);
    assert.equal(getGenerationHistory({ make: 'BMW', model: '528i', year_min: 1997, year_max: 2000 }), null);
    assert.equal(history('528i', [1977, 1978, 1982, 1996, 2001, 2008, 2016]), null);
    assert.equal(history('528i', ['1979', '1997', 1999.5, null]), null);
    assert.equal(history('528', [1979]), null);
    assert.equal(history('528e', [1981]), null);
    assert.equal(history('528xi', [1997]), null);
    assert.equal(history('750Li', [1995]), null);
    assert.equal(history('528i', [1997], 'Toyota'), null);

    for (const year of [1997, 2000]) {
      const result = history('528i', [1982, year, 2008, 2016]);
      assert.equal(result.overview, null);
      assert.deepEqual(result.generations.map(({ code, firstYear, lastYear }) => [code, firstYear, lastYear]), [
        ['E39', 1997, 2000]
      ]);
    }

    const result = history('750iL', [1995, 1994, 1995]);
    assert.match(result.overview, /E32 and E38/);
    assert.deepEqual(result.generations.map(({ code, firstYear, lastYear }) => [code, firstYear, lastYear]), [
      ['E32', 1988, 1994],
      ['E38', 1995, 2001]
    ]);
    assert.deepEqual(history('750iL', [1988]).generations.map(row => row.code), ['E32']);
    assert.deepEqual(history('750iL', [2001]).generations.map(row => row.code), ['E38']);
    assert.equal(history('750iL', [1987, 2002]), null);
  });

  it('uses the U.S. E12 model years and keeps factory production dates separate', function() {
    const e12 = {
      code: 'E12', firstYear: 1979, lastYear: 1981,
      production: '1977–1981', url: archive528iE12
    };
    for (const year of [1979, 1980, 1981]) {
      assert.deepEqual(history('528i', [year]), { overview: null, generations: [e12] });
    }
    const result = history('528i', [1997, 1981, 2008]);
    assert.equal(result.overview, null);
    assert.deepEqual(result.generations.map(generation => generation.code), ['E12', 'E39']);
  });

  it('matches the 840Ci archive only for verified U.S. model years', function() {
    const generation = {
      code: 'E31', firstYear: 1994, lastYear: 1997,
      production: 'July 1993 – May 1999', url: archive840ci
    };
    for (const year of [1994, 1997]) {
      const result = history('840Ci', [1981, year]);
      assert.match(result.overview, /E31/);
      assert.deepEqual(result.generations, [generation]);
    }
    assert.equal(history('840Ci', [1981]), null);
    assert.equal(history('840Ci', [1993, 1998, 1999]), null);
    assert.equal(history('840i', [1997, 2020]), null);
  });

  it('renders matching generation references and preserves Wikidata facts on public detail pages', async function() {
    const fixtures = [
      { model: '750iL', years: [1988, 1994, 1995, 1999], wikidataId: 'Q208', wikiArticle: 'BMW_7_Series_(E38)', summary: 'E38-only fixture introduction.' },
      { model: '528i', years: [1979, 1980, 1981, 1997, 1998, 1999, 2000, 2008, 2016], wikidataId: 'Q642', wikiArticle: 'BMW_5_Series', summary: 'Multi-generation 5 Series fixture introduction.' },
      { model: '840Ci', years: [1994, 1995, 1996, 1997], wikidataId: 'Q840', wikiArticle: 'BMW_8_Series_(E31)', summary: 'E31 fixture introduction.' },
      { model: '840i', years: [2020, 2021], wikidataId: 'Q841', wikiArticle: 'BMW_8_Series_(G15)', summary: 'Modern 8 Series fixture introduction.' }
    ];
    const originalCarinfo = {
      getWikiSummary: carinfo.getWikiSummary,
      getWikidataFacts: carinfo.getWikidataFacts,
      getFuelSpecs: carinfo.getFuelSpecs
    };
    const originalNhtsa = {
      getSafetyRatings: nhtsa.getSafetyRatings,
      getComplaints: nhtsa.getComplaints
    };
    const originalRarity = rarity.getCarRarity;
    const factLookups = [];
    const rarityLookups = [];
    const carIds = [];

    try {
      carinfo.getWikiSummary = async (make, model) => {
        const fixture = fixtures.find(row => row.model === model);
        assert.equal(make, 'BMW');
        return {
          summary: fixture.summary,
          url: 'https://en.wikipedia.org/wiki/' + fixture.wikiArticle,
          wikidataId: fixture.wikidataId
        };
      };
      carinfo.getWikidataFacts = async id => {
        factLookups.push(id);
        return [{ label: 'Wikidata fixture fact', values: ['Source ' + id] }];
      };
      carinfo.getFuelSpecs = async () => null;
      nhtsa.getSafetyRatings = async () => null;
      nhtsa.getComplaints = async () => null;
      rarity.getCarRarity = async (car, id) => {
        rarityLookups.push([car.model, id]);
        return null;
      };

      for (const { model, years } of fixtures) {
        const car = await db.car.create({
          make: 'BMW', model, model_years: years,
          year_min: years[0], year_max: years.at(-1),
          image: PLACEHOLDER_URL, favcount: 0, vehicle_type: 'car'
        });
        carIds.push(car.id);
      }

      const sevenSeries = await request(app).get('/cars/car').query({ make: 'BMW', model: '750iL' }).expect(200);
      assert.match(sevenSeries.text, /BMW generation references/);
      assert.match(sevenSeries.text, /E32 and E38 generations/);
      assert.match(sevenSeries.text, /<dt>E32<\/dt>[\s\S]*?href="https:\/\/www\.bmwgroup-classic\.com\/[^"]+ad-208-1\.bmw-750il-e32\.html"/);
      assert.match(sevenSeries.text, /<dt>E38<\/dt>[\s\S]*?href="https:\/\/www\.bmwgroup-classic\.com\/[^"]+ad-209-1\.bmw-750il-e38\.html"/);
      assert.doesNotMatch(sevenSeries.text, /E38-only fixture introduction|en\.wikipedia\.org\/wiki\/BMW_7_Series_\(E38\)/);
      assert.match(sevenSeries.text, /Source Q208/);

      const fiveSeries = await request(app).get('/cars/car').query({ make: 'BMW', model: '528i' }).expect(200);
      assert.match(fiveSeries.text, /BMW generation references/);
      assert.match(fiveSeries.text, /1979–1981, 1997–2000/);
      assert.match(fiveSeries.text, /<dt>E12<\/dt>\s*<dd>\s*1977–1981 production/);
      assert.ok(fiveSeries.text.includes('href="' + archive528iE12 + '"'));
      assert.match(fiveSeries.text, /<dt>E39<\/dt>[\s\S]*?href="https:\/\/www\.bmwgroup-classic\.com\/[^"]+ad-642-1\.bmw-528i-e39\.html"/);
      assert.doesNotMatch(fiveSeries.text, /<dt>E(?:32|38)<\/dt>/);
      assert.match(fiveSeries.text, /Multi-generation 5 Series fixture introduction/);
      assert.match(fiveSeries.text, /href="https:\/\/en\.wikipedia\.org\/wiki\/BMW_5_Series"/);
      assert.match(fiveSeries.text, /Source Q642/);

      const classicEight = await request(app).get('/cars/car').query({ make: 'BMW', model: '840Ci' }).expect(200);
      const classicHistory = history('840Ci', [1994, 1995, 1996, 1997]);
      assert.ok(classicEight.text.includes(escapeXML(classicHistory.overview)));
      assert.match(classicEight.text, /1994–1997/);
      assert.match(classicEight.text, /<dt>E31<\/dt>[\s\S]*?July 1993 – May 1999 production/);
      assert.ok(classicEight.text.includes('href="' + archive840ci + '"'));
      assert.match(classicEight.text, /Source Q840/);
      assert.doesNotMatch(classicEight.text, /E31 fixture introduction/);

      const modernEight = await request(app).get('/cars/car').query({ make: 'BMW', model: '840i' }).expect(200);
      assert.match(modernEight.text, /Modern 8 Series fixture introduction/);
      assert.doesNotMatch(modernEight.text, /BMW generation references|bmw-840ci-e31/);
      assert.deepEqual(factLookups, fixtures.map(({ wikidataId }) => wikidataId));
      assert.deepEqual(rarityLookups, fixtures.map(({ model, wikidataId }) => [model, wikidataId]));
    } finally {
      Object.assign(carinfo, originalCarinfo);
      Object.assign(nhtsa, originalNhtsa);
      rarity.getCarRarity = originalRarity;
      if (carIds.length) await db.car.destroy({ where: { id: carIds } });
    }
  });
});
