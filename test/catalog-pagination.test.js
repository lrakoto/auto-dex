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
});
