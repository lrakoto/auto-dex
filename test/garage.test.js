const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken } = require('./helpers');

before(async function() {
  await db.sequelize.sync({ force: true });
});

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
});
