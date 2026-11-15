const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('Catalog pagination', function() {
  const models = Array.from({ length: 13 }, (_, i) => `Pagination Fixture ${String(i + 1).padStart(2, '0')}`);
  let realGetModels;

  before(async function() {
    realGetModels = carquery.getModels;
    carquery.getModels = async (make, options) => make === 'Volvo'
      ? models.map(model => ({ make, model }))
      : realGetModels(make, options);
    await db.car.bulkCreate(models.map(model => ({
      make: 'Volvo', model, image: PLACEHOLDER_URL, favcount: 0, updated_img: false,
      vehicle_type: 'car', model_years: [1990], year_min: 1990, year_max: 1990
    })));
  });

  after(async function() {
    carquery.getModels = realGetModels;
    await db.car.destroy({ where: { make: 'Volvo', model: models } });
  });

  function assertFragment(html) {
    assert.match(html, /id="cars-row"/);
    assert.match(html, /Pagination Fixture 13/);
    assert.doesNotMatch(html, /Pagination Fixture 01/);
    assert.doesNotMatch(html, /<(?:html|head|body|main|footer|script)\b/i);
    assert.doesNotMatch(html, /id="nav-search-btn"/);
  }

  it('returns only the requested browse grid for a fragment request', async function() {
    const res = await request(app).get('/cars?selectmake=Volvo&page=2&partial=1').expect(200);
    assertFragment(res.text);
    assert.match(res.text, /href="\/cars\?selectmake=Volvo&amp;page=1"/);
  });

  it('returns only the Explore grid and preserves its filters in page links', async function() {
    const res = await request(app)
      .get('/cars/explore?make=Volvo&decade=1990&sort=az&page=2&partial=1').expect(200);
    assertFragment(res.text);
    assert.match(res.text, /href="\/cars\/explore\?decade=1990&amp;make=Volvo&amp;sort=az&amp;page=1"/);
  });

  it('pages through tied Explore results once in the same order for both year sorts', async function() {
    const make = 'Stable Paging Trucks';
    const inserts = Array.from({ length: 25 }, (_, index) => ({
      make,
      model: `Truck ${String(25 - index).padStart(2, '0')}`,
      image: PLACEHOLDER_URL,
      favcount: 0,
      vehicle_type: 'commercial',
      model_years: [1990],
      year_min: 1990,
      year_max: 1990
    }));
    const rows = await db.car.bulkCreate(inserts);
    try {
      const ordered = rows.sort((a, b) => a.id - b.id).map(row => row.model);
      const expected = [ordered.slice(0, 12), ordered.slice(12, 24), ordered.slice(24)];
      for (const sort of ['newest', 'oldest']) {
        const url = `/cars/explore?type=commercial&make=${encodeURIComponent(make)}&sort=${sort}`;
        const pages = await Promise.all([
          request(app).get(url).expect(200),
          request(app).get(`${url}&page=2&partial=1`).expect(200),
          request(app).get(`${url}&page=3`).expect(200)
        ]);
        const actual = pages.map(({ text }) => Array.from(text.matchAll(/class="card-model">([^<]+)/g), match => match[1]));
        assert.deepEqual(actual, expected, sort);
      }
    } finally {
      await db.car.destroy({ where: { id: rows.map(row => row.id) } });
    }
  });

  it('includes catalog-only manufacturers in Explore without weakening make and country filters', async function() {
    const make = 'Catalog Hauler Works';
    const model = 'Catalog Hauler Fixture';
    const row = await db.car.create({
      make, model, image: PLACEHOLDER_URL, favcount: 100000, updated_img: false,
      vehicle_type: 'commercial', model_years: [1990], year_min: 1990, year_max: 1990
    });
    try {
      const broad = await request(app).get('/cars/explore?type=commercial&sort=popular').expect(200);
      assert.match(broad.text, /<option value="Catalog Hauler Works"\s*>Catalog Hauler Works<\/option>/);
      assert.match(broad.text, /class="card-model">Catalog Hauler Fixture<\/span>/);
      assert.doesNotMatch(broad.text, /class="card-model">Pagination Fixture/);

      const makeUrl = `make=${encodeURIComponent(make)}`;
      const direct = await request(app).get(`/cars/explore?type=commercial&${makeUrl}`).expect(200);
      assert.match(direct.text, /<option value="Catalog Hauler Works" selected>Catalog Hauler Works<\/option>/);
      assert.match(direct.text, /class="card-model">Catalog Hauler Fixture<\/span>/);

      const japan = await request(app).get('/cars/explore?type=all&country=Japan&sort=popular').expect(200);
      assert.match(japan.text, /<option value="Japan" selected>Japan<\/option>/);
      assert.doesNotMatch(japan.text, /class="card-model">Catalog Hauler Fixture<\/span>/);

      // The known Swedish Volvo fixtures would leak if the make filter vanished.
      const mismatch = await request(app).get(`/cars/explore?type=all&country=Sweden&${makeUrl}`).expect(200);
      assert.match(mismatch.text, /No vehicles match these filters/);
      assert.doesNotMatch(mismatch.text, /class="card-model"/);
    } finally {
      await db.car.destroy({ where: { id: row.id } });
    }
  });

  it('serves a complete page with the matching results for normal navigation', async function() {
    for (const [page, present, absent] of [[1, models[0], models[12]], [2, models[12], models[0]]]) {
      const res = await request(app).get(`/cars?selectmake=Volvo&page=${page}`).expect(200);
      assert.match(res.text, /<html\b/i);
      assert.equal((res.text.match(/id="nav-search-btn"/g) || []).length, 1);
      assert.ok(res.text.includes(present));
      assert.ok(!res.text.includes(absent));
      assert.ok(res.text.includes(`class="pg-btn active" data-no-transition>${page}</a>`));
    }
  });

  it('keeps the car tab, year filter and pagination when the upstream list is empty', async function() {
    const extraRows = await db.car.bulkCreate([
      { model: 'A Different Year Fixture', vehicle_type: 'car', year: 2004 },
      { model: 'Pagination Commercial Fixture', vehicle_type: 'commercial', year: 1990 }
    ].map(({ model, vehicle_type, year }) => ({
      make: 'Volvo', model, vehicle_type, image: PLACEHOLDER_URL, favcount: 0, updated_img: false,
      model_years: [year], year_min: year, year_max: year
    })));
    const getModels = carquery.getModels;
    carquery.getModels = (make, options) => make === 'Volvo' ? Promise.resolve([]) : getModels(make, options);

    try {
      const url = '/cars?selectmake=Volvo&year=1990&page=2';
      const page = await request(app).get(url).expect(200);
      assert.match(page.text, /class="type-tab active" href="\/cars\?selectmake=Volvo" aria-current="page"/);
      assert.match(page.text, /href="\/cars\?selectmake=Volvo&amp;type=commercial"/);
      assert.match(page.text, /<option value="1990" selected>/);
      assert.match(page.text, /<option value="2004"\s*>/);
      assert.match(page.text, /Pagination Fixture 13/);
      assert.doesNotMatch(page.text, /Pagination Fixture 12|Pagination Commercial Fixture/);

      const fragment = await request(app).get(url + '&partial=1').expect(200);
      assertFragment(fragment.text);
      assert.match(fragment.text, /href="\/cars\?selectmake=Volvo&amp;year=1990&amp;page=1"/);
    } finally {
      carquery.getModels = getModels;
      await db.car.destroy({ where: { id: extraRows.map(row => row.id) } });
    }
  });
});
