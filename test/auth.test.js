const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken } = require('./helpers');
const { hashToken } = require('../lib/tokens');

// Schema is created once per run from the real migrations (see test/setup.js).

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

    it('responds identically when the email already exists (no enumeration)', async function() {
      const before = await db.user.count();
      const token = await getCsrfToken(agent, '/auth/signup');
      const res = await agent.post('/auth/signup')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ ...testUser, _csrf: token })
        .expect('Location', '/auth/login')
        .expect(302);
      const after = await db.user.count();
      if (after !== before) throw new Error('duplicate signup created a second user');
      if (/already exists/i.test(res.text)) throw new Error('response leaks that the email exists');
    });

    it('normalizes email case/whitespace so it cannot create a second account', async function() {
      const token = await getCsrfToken(agent, '/auth/signup');
      await agent.post('/auth/signup')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send({ email: '  MIKE@EXAMPLE.COM  ', name: 'Mike Again', password: 'password123', _csrf: token })
        .expect(302);
      const matches = await db.user.count({ where: { email: 'mike@example.com' } });
      if (matches !== 1) throw new Error(`expected 1 canonical user, found ${matches}`);
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
        verificationToken: hashToken('expired-token'),
        verificationTokenExpiresAt: new Date(Date.now() - 60 * 1000) // 1 min ago
      });
      await request(app).get('/auth/verify/expired-token')
        .expect('Location', '/auth/login')
        .expect(302);
      const fresh = await db.user.findByPk(stale.id);
      if (fresh.emailVerified) throw new Error('Expired token verified the user');
    });

    it('verifies a user from the plaintext link and clears the stored hash', async function() {
      const user = await db.user.create({
        email: 'verify@example.com',
        name: 'Verify Me',
        password: 'password123',
        emailVerified: false,
        verificationToken: hashToken('good-token'),
        verificationTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await request(app).get('/auth/verify/good-token')
        .expect('Location', '/auth/login')
        .expect(302);
      const fresh = await db.user.findByPk(user.id);
      if (!fresh.emailVerified) throw new Error('valid token did not verify the user');
      if (fresh.verificationToken !== null) throw new Error('verification token was not cleared');
    });
  });
});
