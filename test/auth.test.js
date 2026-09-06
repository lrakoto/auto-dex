const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken } = require('./helpers');

// Wipes and rebuilds the TEST database (autodex_test — never the dev DB)
before(async function() {
  await db.sequelize.sync({ force: true });
});

describe('Auth Controller', function() {
  const agent = request.agent(app);
  const testUser = { email: 'mike@example.com', name: 'Mike Schull', password: 'password123' };

  describe('GET /auth/signup', function() {
    it('should return a 200 response', async function() {
      await request(app).get('/auth/signup').expect(200);
    });
  });

  describe('POST /auth/signup', function() {
    it('should redirect to /auth/login on success', async function() {
      const token = await getCsrfToken(agent, '/auth/signup');
      await agent.post('/auth/signup')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ ...testUser, _csrf: token })
        .expect('Location', '/auth/login')
        .expect(302);
    });

    it('should not create a user without a CSRF token', async function() {
      const before2 = await db.user.count();
      await agent.post('/auth/signup')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ email: 'nocrsf@example.com', name: 'No Token', password: 'password123' })
        .expect(302); // redirected with "form expired" flash
      const after = await db.user.count();
      if (after !== before2) throw new Error('User was created despite missing CSRF token');
    });

    it('should redirect to /auth/signup when email already exists', async function() {
      const token = await getCsrfToken(agent, '/auth/signup');
      await agent.post('/auth/signup')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ ...testUser, _csrf: token })
        .expect('Location', '/auth/signup')
        .expect(302);
    });
  });

  describe('GET /auth/login', function() {
    it('should return a 200 response', async function() {
      await request(app).get('/auth/login').expect(200);
    });
  });

  describe('POST /auth/login', function() {
    it('should reject unverified users back to /auth/login', async function() {
      const token = await getCsrfToken(agent);
      await agent.post('/auth/login')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ email: testUser.email, password: testUser.password, _csrf: token })
        .expect('Location', '/auth/login')
        .expect(302);
    });

    it('should redirect to / on success once verified', async function() {
      await db.user.update(
        { emailVerified: true, verificationToken: null },
        { where: { email: testUser.email } }
      );
      const token = await getCsrfToken(agent);
      await agent.post('/auth/login')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ email: testUser.email, password: testUser.password, _csrf: token })
        .expect('Location', '/')
        .expect(302);
    });

    it('should redirect to /auth/login on bad credentials', async function() {
      const token = await getCsrfToken(agent);
      await agent.post('/auth/login')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ email: testUser.email, password: 'wrong-password', _csrf: token })
        .expect('Location', '/auth/login')
        .expect(302);
    });
  });

  describe('POST /auth/logout', function() {
    it('should redirect to /', async function() {
      const token = await getCsrfToken(agent);
      await agent.post('/auth/logout')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ _csrf: token })
        .expect('Location', '/')
        .expect(302);
    });

    it('GET /auth/logout should not exist (logout is POST-only)', async function() {
      await request(app).get('/auth/logout').expect(404);
    });
  });

  describe('GET /auth/verify/:token', function() {
    it('rejects expired verification tokens', async function() {
      const stale = await db.user.create({
        email: 'stale@example.com',
        name: 'Stale Link',
        password: 'password123',
        emailVerified: false,
        verificationToken: 'expired-token',
        verificationTokenExpiresAt: new Date(Date.now() - 60 * 1000) // 1 min ago
      });
      await request(app).get('/auth/verify/expired-token')
        .expect('Location', '/auth/login')
        .expect(302);
      const fresh = await db.user.findByPk(stale.id);
      if (fresh.emailVerified) throw new Error('Expired token verified the user');
    });
  });
});
