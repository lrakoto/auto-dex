const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const photoCandidates = require('../lib/photoCandidates');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { PLACEHOLDER_URL } = require('../lib/constants');

describe('Reviewed catalog photos', function() {
  const admin = request.agent(app);
  const member = request.agent(app);
  const candidate = {
    provider: 'wikimedia', id: 'File:Accurate_vehicle.jpg', title: 'Reviewed model photo',
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Accurate_vehicle.jpg',
    previewUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Accurate_vehicle.jpg/500px-Accurate_vehicle.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Accurate_vehicle.jpg',
    creditName: 'Example photographer', license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
  };
  let adminUser, car, originalSearch, originalGet, searchCalls, candidateCalls;

  before(async function() {
    adminUser = await createVerifiedUser(admin, db, { email: 'photo-review-admin@example.com' });
    await db.user.update({ isAdmin: true }, { where: { id: adminUser.id } });
    await createVerifiedUser(member, db, { email: 'photo-review-member@example.com' });
  });

  beforeEach(async function() {
    originalSearch = photoCandidates.searchCandidates;
    originalGet = photoCandidates.getCandidate;
    searchCalls = [];
    candidateCalls = [];
    photoCandidates.searchCandidates = async (make, model) => {
      searchCalls.push({ make, model });
      return { candidates: [candidate], errors: [] };
    };
    photoCandidates.getCandidate = async (provider, id, make, model) => {
      candidateCalls.push({ provider, id, make, model });
      return candidate;
    };
    car = await db.car.create({
      make: 'Photo Review', model: `Test ${Date.now()} ${Math.random()}`,
      image: 'https://example.test/previous-cover.jpg', updated_img: true, vehicle_type: 'offroad'
    });
  });

  afterEach(function() {
    photoCandidates.searchCandidates = originalSearch;
    photoCandidates.getCandidate = originalGet;
  });

  async function approve(fields = {}, id = car.id) {
    const token = await getCsrfToken(admin);
    return admin.post(`/garage/admin/photos/${id}`).type('form')
      .send({ provider: 'wikimedia', candidateId: candidate.id, _csrf: token, ...fields });
  }

  it('requires a signed-in admin for both review and approval', async function() {
    await request(app).get('/garage/admin/photos').expect(302).expect('Location', '/auth/login');
    await member.get('/garage/admin/photos').expect(302).expect('Location', '/');
    const token = await getCsrfToken(member);
    await member.post(`/garage/admin/photos/${car.id}`).type('form')
      .send({ provider: candidate.provider, candidateId: candidate.id, _csrf: token })
      .expect(302).expect('Location', '/');
    assert.equal(candidateCalls.length, 0);
    await car.reload();
    assert.equal(car.image, 'https://example.test/previous-cover.jpg');
  });

  it('requires CSRF protection before approving a photo', async function() {
    await admin.post(`/garage/admin/photos/${car.id}`).type('form')
      .send({ provider: candidate.provider, candidateId: candidate.id }).expect(302).expect('Location', '/');
    const expired = await admin.get('/garage/admin/photos').expect(200);
    assert(expired.text.includes('That form expired — please try again.'));
    assert.equal(candidateCalls.length, 0);
    await car.reload();
    assert.equal(car.image, 'https://example.test/previous-cover.jpg');
    assert.equal(await db.car_image.count({ where: { carId: car.id } }), 0);
  });

  it('starts with a search rather than listing the whole catalog or calling providers', async function() {
    const res = await admin.get('/garage/admin/photos').expect(200);
    assert(!res.text.includes(car.model));
    assert.equal(searchCalls.length, 0);
    assert.match(res.text, /name="robots" content="noindex/);
    assert.match(res.text, /rel="canonical" href="[^"]*\/garage\/admin\/photos"/);
  });

  it('finds every vehicle type and only searches providers for a selected catalog row', async function() {
    const res = await admin.get('/garage/admin/photos').query({ q: car.model }).expect(200);
    assert(res.text.includes(car.model));
    assert.equal(searchCalls.length, 0);
    const selected = await admin.get('/garage/admin/photos').query({ carId: car.id }).expect(200);
    assert(selected.text.includes('previous-cover.jpg'));
    assert(selected.text.includes(candidate.title));
    assert.deepEqual(searchCalls, [{ make: car.make, model: car.model }]);
    await car.reload();
    assert.equal(car.image, 'https://example.test/previous-cover.jpg');
    assert.equal(await db.car_image.count({ where: { carId: car.id } }), 0);
  });

  it('bounds catalog results and treats search wildcards literally', async function() {
    const make = `Photo Pages ${Date.now()}`;
    await db.car.bulkCreate(Array.from({ length: 25 }, (_, i) => ({ make, model: `Unit ${String(i).padStart(2, '0')}` })));
    const first = await admin.get('/garage/admin/photos').query({ q: make }).expect(200);
    assert(first.text.includes('Unit 00'));
    assert(!first.text.includes('Unit 24'));
    const second = await admin.get('/garage/admin/photos').query({ q: make, page: '999999' }).expect(200);
    assert(second.text.includes('Unit 24'));
    assert(!second.text.includes('Unit 00'));
    const literal = await db.car.create({ make: 'Photo Literal', model: '100%_Complete' });
    const exact = await admin.get('/garage/admin/photos').query({ q: '%_' }).expect(200);
    assert(exact.text.includes(literal.model));
    assert(!exact.text.includes(car.model));
    assert.equal(searchCalls.length, 0);
  });

  it('rejects malformed and missing catalog ids without contacting a photo source', async function() {
    for (const id of ['1suffix', '0', '-1', '2147483648', '1.0']) {
      await admin.get('/garage/admin/photos').query({ carId: id }).expect(400);
      const res = await approve({}, id);
      assert.equal(res.status, 400);
    }
    await admin.get('/garage/admin/photos').query({ carId: '2147483647' }).expect(404);
    const missing = await approve({}, '2147483647');
    assert.equal(missing.status, 404);
    assert.equal(searchCalls.length, 0);
    assert.equal(candidateCalls.length, 0);
  });

  it('rejects unknown providers and malformed candidate ids without trusting submitted URLs', async function() {
    for (const fields of [
      { provider: 'unsplash' }, { provider: ['wikimedia', 'openverse'] },
      { candidateId: '' }, { candidateId: 'x'.repeat(513) }, { candidateId: { url: 'https://evil.test/car.jpg' } }
    ]) {
      const res = await approve(fields);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, `/garage/admin/photos?carId=${car.id}`);
    }
    assert.equal(candidateCalls.length, 0);
    assert.equal(await db.car_image.count({ where: { carId: car.id } }), 0);
  });

  it('re-fetches the approved candidate and saves its trusted photo, credits and license', async function() {
    const old = await db.car_image.create({ carId: car.id, url: car.image, source: 'unsplash', score: 2 });
    const res = await approve({ imageUrl: 'https://evil.test/forged.jpg', creditName: 'Forged credit', license: 'Forged license' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/garage/admin/photos?carId=${car.id}`);
    assert.deepEqual(candidateCalls, [{ provider: 'wikimedia', id: candidate.id, make: car.make, model: car.model }]);
    await car.reload();
    assert.equal(car.image, candidate.url);
    assert.equal(car.updated_img, true);
    const image = await db.car_image.findOne({ where: { carId: car.id, url: candidate.url } });
    assert.equal(image.userId, adminUser.id);
    assert.equal(image.source, 'wikimedia');
    assert.equal(image.credit_name, candidate.creditName);
    assert.equal(image.credit_url, candidate.sourceUrl);
    assert.equal(image.license, candidate.license);
    assert.equal(image.license_url, candidate.licenseUrl);
    assert.equal(image.credit_checked, true);
    assert(await db.car_image.findByPk(old.id), 'previous gallery image was removed');
  });

  it('retains legacy covers and updates source metadata on an already stored candidate', async function() {
    await db.car_image.create({ carId: car.id, url: candidate.url, source: 'catalog' });
    const res = await approve();
    assert.equal(res.status, 302);
    const images = await db.car_image.findAll({ where: { carId: car.id } });
    assert.equal(images.length, 2);
    assert(images.some(image => image.url === 'https://example.test/previous-cover.jpg'));
    const image = images.find(image => image.url === candidate.url);
    assert.equal(image.source, 'wikimedia');
    assert.equal(image.license, candidate.license);
    assert.equal(image.credit_name, candidate.creditName);
  });

  it('rolls back hero, gallery history and attribution together when a write fails', async function() {
    await car.update({ updated_img: false });
    const existing = await db.car_image.create({
      carId: car.id, url: candidate.url, source: 'catalog', credit_name: 'Previous credit', license: 'Previous license'
    });
    db.car.addHook('beforeBulkUpdate', 'photo-review-write-failure', options => {
      if (options.where.id === car.id && options.attributes.image === candidate.url) throw new Error('Simulated cover write failure');
    });
    try {
      const res = await approve();
      assert.equal(res.status, 302);
    } finally {
      db.car.removeHook('beforeBulkUpdate', 'photo-review-write-failure');
    }
    await Promise.all([car.reload(), existing.reload()]);
    assert.equal(car.image, 'https://example.test/previous-cover.jpg');
    assert.equal(car.updated_img, false);
    assert.equal(existing.source, 'catalog');
    assert.equal(existing.credit_name, 'Previous credit');
    assert.equal(existing.license, 'Previous license');
    assert.equal(await db.car_image.count({ where: { carId: car.id } }), 1, 'old-cover history insert did not roll back');
  });

  it('keeps retired raw covers only as hidden gallery history after approval', async function() {
    const previousUrl = 'https://images.unsplash.com/photo-history';
    await car.update({ image: previousUrl });
    const res = await approve();
    assert.equal(res.status, 302);
    await car.reload();
    assert.equal(car.image, candidate.url);
    const historical = await db.car_image.findOne({ where: { carId: car.id, url: previousUrl } });
    assert(historical, 'raw retired cover history was discarded');
    const gallery = await require('../lib/gallery').getGallery(car.id, adminUser.id, car.image);
    assert(!gallery.some(image => image.url === previousUrl), 'retired history became a visible gallery option');
  });

  it('stores Openverse attribution using the same reviewed flow', async function() {
    const openverse = { ...candidate, provider: 'openverse', id: 'ee42bb78-007c-4f63-a25c-88b05cee9858', sourceUrl: 'https://example.test/original-photo' };
    photoCandidates.getCandidate = async (provider, id) => {
      assert.equal(provider, 'openverse');
      assert.equal(id, openverse.id);
      return openverse;
    };
    const res = await approve({ provider: 'openverse', candidateId: openverse.id });
    assert.equal(res.status, 302);
    const image = await db.car_image.findOne({ where: { carId: car.id, url: candidate.url } });
    assert.equal(image.source, 'openverse');
    assert.equal(image.credit_url, openverse.sourceUrl);
    assert.equal(image.license_url, openverse.licenseUrl);
  });

  it('keeps the current cover when an approval source fails or no longer returns a usable photo', async function() {
    for (const lookup of [async () => null, async () => { throw new Error('upstream unavailable'); }]) {
      photoCandidates.getCandidate = lookup;
      const res = await approve();
      assert.equal(res.status, 302);
      await car.reload();
      assert.equal(car.image, 'https://example.test/previous-cover.jpg');
      assert.equal(await db.car_image.count({ where: { carId: car.id } }), 0);
    }
  });

  it('renders partial source failures without changing the catalog', async function() {
    photoCandidates.searchCandidates = async () => ({ candidates: [candidate], errors: [{ provider: 'openverse', message: 'Openverse is temporarily unavailable.' }] });
    const res = await admin.get('/garage/admin/photos').query({ carId: car.id }).expect(200);
    assert(res.text.includes(candidate.title));
    assert(res.text.includes('Openverse is temporarily unavailable.'));
    photoCandidates.searchCandidates = async () => { throw new Error('both sources unavailable'); };
    const unavailable = await admin.get('/garage/admin/photos').query({ carId: car.id }).expect(200);
    assert(unavailable.text.includes('Photo sources are unavailable right now.'));
    await car.reload();
    assert.equal(car.image, 'https://example.test/previous-cover.jpg');
  });

  it('rejects pending retired and invalid proposals using their raw URL instead of the display placeholder', async function() {
    for (const imageUrl of ['https://images.unsplash.com/photo-pending', 'javascript:alert(1)']) {
      const proposal = await db.image_proposal.create({ carId: car.id, userId: adminUser.id, imageUrl, status: 'pending' });
      const token = await getCsrfToken(admin);
      await admin.post(`/garage/admin/proposal/${proposal.id}/approve`).type('form').send({ _csrf: token })
        .expect(302).expect('Location', '/garage/admin');
      await proposal.reload();
      assert.equal(proposal.status, 'rejected');
      assert.equal(proposal.getDataValue('imageUrl'), imageUrl);
    }
    await car.reload();
    assert.equal(car.image, 'https://example.test/previous-cover.jpg');
    assert.equal(await db.car_image.count({ where: { carId: car.id } }), 0, 'an unsafe proposal was turned into a gallery placeholder');
  });

  it('retries Commons only for missing or retired covers while preserving stored photo history', async function() {
    const retiredUrl = 'https://images.unsplash.com/photo-retired?w=1080';
    const retired = await db.car.create({ make: 'Photo Retry', model: 'Retired', image: retiredUrl, wiki_checked: true, wiki_checked_at: new Date() });
    const missing = await db.car.create({ make: 'Photo Retry', model: 'Missing', image: PLACEHOLDER_URL, wiki_checked: true, wiki_checked_at: new Date() });
    await car.update({ wiki_checked: true, wiki_checked_at: new Date() });
    await admin.post('/garage/admin/retry-photos').type('form').send({}).expect(302).expect('Location', '/');
    const expired = await admin.get('/garage/admin/photos').expect(200);
    assert(expired.text.includes('That form expired — please try again.'));
    await Promise.all([retired.reload(), missing.reload(), car.reload()]);
    assert.equal(retired.wiki_checked, true);
    assert.equal(missing.wiki_checked, true);
    assert.equal(car.wiki_checked, true);
    assert.equal(candidateCalls.length, 0);
    const memberToken = await getCsrfToken(member);
    await member.post('/garage/admin/retry-photos').type('form').send({ _csrf: memberToken }).expect(302).expect('Location', '/');
    await retired.reload();
    assert.equal(retired.wiki_checked, true);
    const token = await getCsrfToken(admin);
    await admin.post('/garage/admin/retry-photos').type('form').send({ _csrf: token }).expect(302).expect('Location', '/garage/admin');
    await Promise.all([retired.reload(), missing.reload(), car.reload()]);
    assert.equal(retired.wiki_checked, false);
    assert.equal(retired.wiki_checked_at, null);
    assert.equal(retired.getDataValue('image'), retiredUrl);
    assert.equal(missing.wiki_checked, false);
    assert.equal(car.wiki_checked, true);
    assert.equal(car.image, 'https://example.test/previous-cover.jpg');
    await admin.post('/garage/admin/reset-unsplash-queue').type('form').send({ _csrf: token }).expect(404);
  });
});
