const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken, createVerifiedUser } = require('./helpers');

describe('Garage', function() {
  const agent = request.agent(app);
  const testUser = { email: 'steve@example.com', name: 'Steve Peters', password: 'password123' };

  it('should redirect to /auth/login if not logged in', async function() {
    await request(app).get('/garage')
      .expect('Location', '/auth/login')
      .expect(302);
  });

  it('should return a 200 response if logged in', async function() {
    // Signup → verify → login → garage
    let token = await getCsrfToken(agent, '/auth/signup');
    await agent.post('/auth/signup')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ ...testUser, _csrf: token })
      .expect(302);

    await db.user.update({ emailVerified: true }, { where: { email: testUser.email } });

    token = await getCsrfToken(agent);
    await agent.post('/auth/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ email: testUser.email, password: testUser.password, _csrf: token })
      .expect('Location', '/');

    await agent.get('/garage').expect(200);
  });

  it('adds and removes a garage car, scoped to the owner', async function() {
    const owner = request.agent(app);
    await createVerifiedUser(owner, db, { email: 'owner@example.com' });
    const other = request.agent(app);
    const otherUser = await createVerifiedUser(other, db, { email: 'other@example.com' });

    const token = await getCsrfToken(owner, '/garage/add');
    await owner.post('/garage/add')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ make: 'Toyota', model: 'Camry', year: '2020', _csrf: token })
      .expect('Location', '/garage')
      .expect(302);

    const car = await db.user_car.findOne({ where: { make: 'Toyota', model: 'Camry' } });
    if (!car) throw new Error('garage car was not created');

    // A different user must not be able to delete it (IDOR)
    const otherToken = await getCsrfToken(other);
    await other.post(`/garage/car/${car.id}?_method=DELETE`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ _csrf: otherToken })
      .expect(302);
    const stillThere = await db.user_car.findByPk(car.id);
    if (!stillThere) throw new Error('another user deleted the car (IDOR)');
    if (otherUser.id === car.userId) throw new Error('unexpected owner');

    // The owner can delete it
    const ownerToken = await getCsrfToken(owner);
    await owner.post(`/garage/car/${car.id}?_method=DELETE`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ _csrf: ownerToken })
      .expect(302);
    const gone = await db.user_car.findByPk(car.id);
    if (gone) throw new Error('owner could not delete their car');
  });
});
