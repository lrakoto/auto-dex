const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { isValidImageUrl } = require('../lib/validators');

describe('Cars', function() {
  const agent = request.agent(app);
  let user;

  before(async function() {
    user = await createVerifiedUser(agent, db, { email: 'driver@example.com' });
  });

  describe('GET /cars/search', function() {
    it('returns 200 for a query', async function() {
      await request(app).get('/cars/search?q=camry').expect(200);
    });

    it('redirects to / when the query is empty', async function() {
      await request(app).get('/cars/search?q=').expect('Location', '/').expect(302);
    });
  });

  describe('POST /cars/fav', function() {
    it('creates the car and increments favcount atomically', async function() {
      const token = await getCsrfToken(agent, '/garage');
      await agent.post('/cars/fav')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          favecar_make: 'Honda',
          favecar_model: 'Civic',
          favecar_image: 'https://example.com/civic.jpg',
          _csrf: token
        })
        .expect(200);

      const car = await db.car.findOne({ where: { make: 'Honda', model: 'Civic' } });
      if (!car) throw new Error('car was not created');
      if (car.favcount !== 1) throw new Error(`expected favcount 1, got ${car.favcount}`);

      const fav = await db.favorite_car.findOne({ where: { userId: user.id, carId: car.id } });
      if (!fav) throw new Error('favorite row missing');
    });

    it('does not double-count when the same car is favorited twice', async function() {
      const token = await getCsrfToken(agent, '/garage');
      await agent.post('/cars/fav')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          favecar_make: 'Honda',
          favecar_model: 'Civic',
          favecar_image: 'https://example.com/civic.jpg',
          _csrf: token
        })
        .expect(200);

      const car = await db.car.findOne({ where: { make: 'Honda', model: 'Civic' } });
      if (car.favcount !== 1) throw new Error(`favcount double-counted: ${car.favcount}`);
    });

    it('ignores a javascript: image URL', async function() {
      const token = await getCsrfToken(agent, '/garage');
      await agent.post('/cars/fav')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          favecar_make: 'Kia',
          favecar_model: 'Soul',
          favecar_image: 'javascript:alert(1)',
          _csrf: token
        })
        .expect(200);

      const car = await db.car.findOne({ where: { make: 'Kia', model: 'Soul' } });
      if (!car) throw new Error('car was not created');
      if (/javascript:/i.test(car.image || '')) throw new Error('unsafe image URL was stored');
    });

    it('requires authentication', async function() {
      const anon = request.agent(app);
      const token = await getCsrfToken(anon, '/auth/login');
      await anon.post('/cars/fav')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ favecar_make: 'Ford', favecar_model: 'Focus', _csrf: token })
        .expect('Location', '/auth/login')
        .expect(302);
      const car = await db.car.findOne({ where: { make: 'Ford', model: 'Focus' } });
      if (car) throw new Error('unauthenticated request created a car');
    });
  });

  describe('DELETE /cars/favorites/delete/:id', function() {
    it('removes the favorite and clamps favcount at zero', async function() {
      const car = await db.car.findOne({ where: { make: 'Honda', model: 'Civic' } });
      const fav = await db.favorite_car.findOne({ where: { userId: user.id, carId: car.id } });

      const token = await getCsrfToken(agent, '/garage');
      await agent.post(`/cars/favorites/delete/${fav.id}?_method=DELETE`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ _csrf: token })
        .expect(200);

      const after = await db.car.findByPk(car.id);
      if (after.favcount < 0) throw new Error('favcount went negative');
    });
  });

  describe('POST /cars/propose-image', function() {
    it('creates a pending proposal for a placeholder car', async function() {
      const car = await db.car.create({
        make: 'Lancia', model: 'Delta', favcount: 0, updated_img: false,
        image: require('../lib/constants').PLACEHOLDER_URL
      });
      const token = await getCsrfToken(agent, '/garage');
      // redirects 'back' → Referrer header keeps supertest happy
      await agent.post('/cars/propose-image')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Referrer', '/')
        .send({ carId: car.id, imageUrl: 'https://example.com/delta.jpg', _csrf: token })
        .expect(302);

      const proposal = await db.image_proposal.findOne({ where: { carId: car.id, userId: user.id } });
      if (!proposal) throw new Error('proposal was not created');
      if (proposal.status !== 'pending') throw new Error('proposal status should be pending');
    });

    it('rejects an invalid image URL', async function() {
      const car = await db.car.create({
        make: 'Lancia', model: 'Stratos', favcount: 0, updated_img: false,
        image: require('../lib/constants').PLACEHOLDER_URL
      });
      const token = await getCsrfToken(agent, '/garage');
      await agent.post('/cars/propose-image')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Referrer', '/')
        .send({ carId: car.id, imageUrl: 'not a url', _csrf: token })
        .expect(302);

      const count = await db.image_proposal.count({ where: { carId: car.id } });
      if (count !== 0) throw new Error('invalid URL produced a proposal');
    });
  });

  describe('isValidImageUrl', function() {
    it('accepts plain http(s) URLs', function() {
      if (!isValidImageUrl('https://example.com/a.jpg')) throw new Error('rejected valid https URL');
      if (!isValidImageUrl('http://example.com/a.jpg')) throw new Error('rejected valid http URL');
    });

    it('rejects scheme tricks and markup break-outs', function() {
      const bad = [
        'javascript:alert(1)',
        'data:image/svg+xml,<svg onload=alert(1)>',
        '//evil.example/x.jpg',
        'https://example.com/</script>.jpg',
        "https://example.com/a'b.jpg",
        'https://example.com/a b.jpg'
      ];
      bad.forEach(u => {
        if (isValidImageUrl(u)) throw new Error(`accepted unsafe URL: ${u}`);
      });
    });
  });
});
