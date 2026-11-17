const assert = require('node:assert/strict');
const request = require('supertest');
const ejs = require('ejs');
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

  function assertPager(html, baseUrl, page, totalPages, numbers = [1, 2]) {
    const pager = html.match(/<nav\b[^>]*class="pagination-wrap"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    assert.ok(pager, 'missing pagination landmark');
    assert.match(pager, /^<nav\b[^>]*aria-label="Catalog pages"/);
    const links = Array.from(pager.matchAll(/<a\b[^>]*>/g), ([tag]) => tag);
    assert.equal(links.filter(link => link.includes('aria-current="page"')).length, 1);

    function assertLink(label, number, current = false) {
      const link = links.find(tag => tag.includes('aria-label="' + label + '"'));
      assert.ok(link, 'missing ' + label);
      assert.ok(link.includes('href="' + baseUrl + number + '"'), 'wrong URL for ' + label);
      assert.match(link, /\bdata-no-transition\b/);
      assert.equal(link.includes('aria-current="page"'), current, label);
      if (current) assert.match(link, /\bclass="pg-btn active"/);
    }

    for (const number of numbers) assertLink('Page ' + number, number, number === page);
    if (page > 1) assertLink('Previous page', page - 1);
    else assert.ok(!links.some(link => link.includes('aria-label="Previous page"')));
    if (page < totalPages) assertLink('Next page', page + 1);
    else assert.ok(!links.some(link => link.includes('aria-label="Next page"')));

    const disabled = Array.from(pager.matchAll(/<span\b[^>]*class="pg-btn disabled"[^>]*>/g), ([tag]) => tag);
    assert.equal(disabled.length, Number(page === 1) + Number(page === totalPages));
    for (const tag of disabled) assert.match(tag, /\baria-hidden="true"/);
  }

  it('returns only the requested browse grid for a fragment request', async function() {
    const res = await request(app).get('/cars?selectmake=Volvo&page=2&partial=1').expect(200);
    assertFragment(res.text);
    assertPager(res.text, '/cars?selectmake=Volvo&amp;page=', 2, 2);
  });

  it('returns only the Explore grid and preserves its filters in page links', async function() {
    const res = await request(app)
      .get('/cars/explore?make=Volvo&decade=1990&sort=az&page=2&partial=1').expect(200);
    assertFragment(res.text);
    assertPager(res.text, '/cars/explore?decade=1990&amp;make=Volvo&amp;sort=az&amp;page=', 2, 2);
  });

  it('keeps ellipses decorative and labels distant page links', async function() {
    const baseUrl = '/cars/explore?page=';
    const pager = await ejs.renderFile(require.resolve('../views/partials/pagination.ejs'), {
      page: 10, totalPages: 20, baseUrl
    });
    assertPager(pager, baseUrl, 10, 20, [1, 8, 9, 10, 11, 12, 20]);
    const ellipses = Array.from(pager.matchAll(/<span\b[^>]*class="pg-ellipsis"[^>]*>/g), ([tag]) => tag);
    assert.equal(ellipses.length, 2);
    for (const tag of ellipses) assert.match(tag, /\baria-hidden="true"/);
  });

  function assertFilterForm(html, className, action, label) {
    const forms = Array.from(html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g), ([form]) => form);
    const form = forms.find(entry => entry.slice(0, entry.indexOf('>')).includes('class="' + className + '"'));
    assert.ok(form, 'missing ' + className + ' form');
    const opening = form.slice(0, form.indexOf('>'));
    assert.ok(opening.includes('action="' + action + '"'));
    assert.match(opening, /\bmethod="get"/i);
    assert.doesNotMatch(form, /<noscript\b|\bauto-submit\b|\bname="(?:page|partial)"/i);
    const button = form.match(/<button\b[^>]*\btype="submit"[^>]*>\s*[^<]+\s*<\/button>/)?.[0];
    assert.ok(button, 'missing submit button');
    assert.doesNotMatch(button, /^<button\b[^>]*\bhidden\b/);
    assert.equal(button.slice(button.indexOf('>') + 1, button.lastIndexOf('<')).trim(), label);
    return form;
  }

  it('applies Explore filters together and starts at the first page', async function() {
    const filters = '/cars/explore?type=all&decade=1990&country=Sweden&make=Volvo';
    const pageTwo = await request(app).get(filters + '&sort=az&page=2').expect(200);
    assert.match(pageTwo.text, /class="card-model">Pagination Fixture 13<\/span>/);
    const form = assertFilterForm(pageTwo.text, 'explore-filters', '/cars/explore', 'Apply filters');
    for (const value of ['all', '1990', 'Sweden', 'Volvo', 'az']) {
      assert.ok(form.includes('value="' + value + '" selected'), value);
    }
    assert.match(form, /<input\b(?=[^>]*\bname="photos")(?=[^>]*\bvalue="1")[^>]*>/);

    const submitted = filters + '&sort=newest';
    const first = await request(app).get(submitted).expect(200);
    const appliedForm = assertFilterForm(first.text, 'explore-filters', '/cars/explore', 'Apply filters');
    for (const value of ['all', '1990', 'Sweden', 'Volvo', 'newest']) {
      assert.ok(appliedForm.includes('value="' + value + '" selected'), value);
    }
    assert.match(first.text, /class="card-model">Pagination Fixture 01<\/span>/);
    assert.doesNotMatch(first.text, /class="card-model">Pagination Fixture 13<\/span>/);
    assertPager(first.text, submitted.replaceAll('&', '&amp;') + '&amp;page=', 1, 2);
  });

  it('offers earlier Explore decades and matches recorded model years within them', async function() {
    const rows = await db.car.bulkCreate([
      { model: 'Early Sedan Fixture', years: [1979, 1980, 1981, 1997, 1998, 1999, 2000] },
      { model: 'Decade Gap Fixture', years: [1959, 1980] }
    ].map(({ model, years }) => ({
      make: 'BMW', model, image: PLACEHOLDER_URL, favcount: 0, vehicle_type: 'car',
      model_years: years, year_min: years[0], year_max: years.at(-1)
    })));
    try {
      const historical = '/cars/explore?type=all&decade=1970&country=Germany&make=BMW&sort=az';
      const res = await request(app).get(historical).expect(200);
      const form = assertFilterForm(res.text, 'explore-filters', '/cars/explore', 'Apply filters');
      assert.match(form, /<option value="1970" selected>1970s<\/option>/);
      assert.match(form, /<option value="1950"\s*>1950s<\/option>/);
      assert.doesNotMatch(form, /<option value="1960"\s/);
      assert.match(form, /<option value="1980"\s*>1980s<\/option>/);
      assert.match(res.text, /class="card-model">Early Sedan Fixture<\/span>/);
      assert.doesNotMatch(res.text, /class="card-model">Decade Gap Fixture<\/span>/);

      const sweden = await request(app)
        .get('/cars/explore?type=all&decade=1970&country=Sweden&make=Volvo&sort=az').expect(200);
      assert.match(sweden.text, /<option value="1970" selected>1970s<\/option>/);
      assert.doesNotMatch(sweden.text, /class="card-model">Pagination Fixture/);

      const stale = await request(app).get(historical + '&page=99&partial=1').expect(200);
      assert.match(stale.text, /id="cars-row"/);
      assert.doesNotMatch(stale.text, /<html\b/i);
      const firstPage = stale.text.match(/href="([^"]+)"[^>]*>Back to first page<\/a>/)?.[1];
      assert.equal(firstPage, historical.replaceAll('&', '&amp;') + '&amp;page=1');
    } finally {
      await db.car.destroy({ where: { id: rows.map(row => row.id) } });
    }
  });

  it('applies the model year while keeping the manufacturer and vehicle type', async function() {
    const make = 'Year Filter Works';
    const rows = await db.car.bulkCreate(Array.from({ length: 13 }, (_, index) => ({
      make,
      model: 'Year Filter Truck ' + String(index + 1).padStart(2, '0'),
      image: PLACEHOLDER_URL,
      favcount: 0,
      vehicle_type: 'commercial',
      model_years: index === 12 ? [1990, 1991] : [1990],
      year_min: 1990,
      year_max: index === 12 ? 1991 : 1990
    })));
    try {
      const browse = '/cars?selectmake=' + encodeURIComponent(make) + '&type=commercial';
      const pageTwo = await request(app).get(browse + '&year=1990&page=2').expect(200);
      const form = assertFilterForm(pageTwo.text, 'year-filter', '/cars', 'Apply year');
      assert.match(form, /<input\b(?=[^>]*\btype="hidden")(?=[^>]*\bname="selectmake")(?=[^>]*\bvalue="Year Filter Works")[^>]*>/);
      assert.match(form, /<input\b(?=[^>]*\btype="hidden")(?=[^>]*\bname="type")(?=[^>]*\bvalue="commercial")[^>]*>/);
      assert.match(form, /<select\b[^>]*\bname="year"/);
      assert.match(form, /<option value="1990" selected>/);
      assertPager(pageTwo.text, browse.replaceAll('&', '&amp;') + '&amp;year=1990&amp;page=', 2, 2);

      const first = await request(app).get(browse + '&year=1991').expect(200);
      const appliedForm = assertFilterForm(first.text, 'year-filter', '/cars', 'Apply year');
      assert.match(appliedForm, /<option value="1991" selected>/);
      assert.equal(Array.from(appliedForm.matchAll(/<option value="1991"/g)).length, 1);
      assert.match(first.text, /class="card-model">Year Filter Truck 13<\/span>/);
      assert.doesNotMatch(first.text, /class="card-model">Year Filter Truck 01<\/span>|class="pagination-wrap"/);
    } finally {
      await db.car.destroy({ where: { id: rows.map(row => row.id) } });
    }
  });

  it('shows the active year and a reset link when a saved model year has no matches', async function() {
    const browse = '/cars?selectmake=Volvo';
    const saved = browse + '&year=1989&page=4';
    const page = await request(app).get(saved).expect(200);
    const form = assertFilterForm(page.text, 'year-filter', '/cars', 'Apply year');
    assert.match(form, /<option value="">All years<\/option>/);
    assert.match(form, /<option value="1989" selected>1989<\/option>/);
    assert.match(form, /<option value="1990"\s*>1990<\/option>/);

    const fragment = await request(app).get(saved + '&partial=1').expect(200);
    assert.doesNotMatch(fragment.text, /<html\b|id="yearFilter"/i);
    for (const { text } of [page, fragment]) {
      assert.match(text, /<h3>No models found for 1989<\/h3>/);
      assert.doesNotMatch(text, /class="card-model"|No vehicles on this page/);
      const link = text.match(/href="([^"]+)"[^>]*>Clear year filter<\/a>/)?.[1];
      assert.equal(link, browse);
    }
    const cleared = await request(app).get(browse).expect(200);
    assert.match(cleared.text, /class="card-model">Pagination Fixture 01<\/span>/);
    assert.doesNotMatch(cleared.text, /<option value="1989"/);
  });

  it('can clear a saved year when a manufacturer has no dated listings', async function() {
    const make = 'Undated Year Filter';
    const truck = await db.car.create({
      make, model: 'Undated Truck Fixture', image: PLACEHOLDER_URL, vehicle_type: 'commercial'
    });
    try {
      const browse = '/cars?selectmake=' + encodeURIComponent(make);
      const alias = '/cars?selectmake=' + encodeURIComponent(make.toLowerCase());
      await request(app).get(alias + '&type=car&year=1990')
        .expect(301).expect('Location', browse + '&type=car&year=1990');
      for (const type of ['commercial', 'car']) {
        const typed = browse + '&type=' + type;
        const page = await request(app).get(typed + '&year=1990').expect(200);
        const form = assertFilterForm(page.text, 'year-filter', '/cars', 'Apply year');
        assert.ok(form.includes(`<input type="hidden" name="type" value="${type}">`));
        assert.match(form, /<option value="1990" selected>1990<\/option>/);
        assert.doesNotMatch(page.text, /class="card-model"|class="browse-link"/);
        assert.ok(page.text.includes(`href="${typed.replaceAll('&', '&amp;')}" class="btn btn-outline-secondary mt-3">Clear year filter`));
      }
      const cleared = await request(app).get(browse + '&type=commercial&year=').expect(200);
      assert.match(cleared.text, /class="card-model">Undated Truck Fixture<\/span>/);
      assert.doesNotMatch(cleared.text, /id="yearFilter"/);
    } finally {
      await db.car.destroy({ where: { id: truck.id } });
    }
  });

  it('recovers from stale catalog pages without losing filters', async function() {
    const commercial = await db.car.create({
      make: 'Volvo', model: 'Stale Page Truck Fixture', image: PLACEHOLDER_URL, favcount: 0,
      vehicle_type: 'commercial', model_years: [1990], year_min: 1990, year_max: 1990
    });
    try {
      const browse = '/cars?selectmake=Volvo&year=1990';
      const cases = [
        { url: browse, model: models[0] },
        { url: browse, model: models[0], partial: true },
        { url: '/cars?selectmake=Volvo&type=commercial&year=1990', model: commercial.model },
        { url: '/cars/explore?make=Volvo&decade=1990&sort=az', model: models[0], partial: true }
      ];
      for (const { url, model, partial } of cases) {
        const staleUrl = url + '&page=99' + (partial ? '&partial=1' : '');
        const stale = await request(app).get(staleUrl).expect(200);
        assert.match(stale.text, /No vehicles on this page/, staleUrl);
        assert.doesNotMatch(stale.text, /class="pagination-wrap"|class="card-model"/, staleUrl);
        if (partial) {
          assert.match(stale.text, /id="cars-row"/, staleUrl);
          assert.doesNotMatch(stale.text, /<html\b/i, staleUrl);
        }

        const href = stale.text.match(/href="([^"]+)"[^>]*>Back to first page<\/a>/)?.[1];
        assert.ok(href, staleUrl);
        const destination = new URL(href.replaceAll('&amp;', '&'), 'http://autodex.test');
        const original = new URL(url, 'http://autodex.test');
        assert.equal(destination.pathname, original.pathname, staleUrl);
        assert.equal(destination.searchParams.get('page') ?? '1', '1', staleUrl);
        destination.searchParams.delete('page');
        assert.deepEqual(Object.fromEntries(destination.searchParams), Object.fromEntries(original.searchParams), staleUrl);

        const recovered = await request(app).get(href.replaceAll('&amp;', '&')).expect(200);
        assert.ok(recovered.text.includes(`class="card-model">${model}</span>`), staleUrl);
      }
    } finally {
      await db.car.destroy({ where: { id: commercial.id } });
    }
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
      assertPager(res.text, '/cars?selectmake=Volvo&amp;page=', page, 2);
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
