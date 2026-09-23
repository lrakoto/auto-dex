const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { getCsrfToken } = require('./helpers');
const { hashToken } = require('../lib/tokens');

// Uses a user created straight in the DB and one login per agent — the auth
// rate limiters are shared across the whole suite.
describe('Password reset', function() {
  const email = 'forgetful@example.com';
  const oldPassword = 'old-password-1';
  const newPassword = 'new-password-2';
  let user;

  before(async function() {
    user = await db.user.create({ name: 'Forgetful', email, password: oldPassword, emailVerified: false });
  });

  function post(agent, url, body, token) {
    return agent.post(url)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ ...body, _csrf: token });
  }

  async function issueToken(plain, expiresInMs = 60 * 60 * 1000) {
    await db.user.update(
      { passwordResetToken: hashToken(plain), passwordResetExpiresAt: new Date(Date.now() + expiresInMs) },
      { where: { id: user.id } }
    );
  }

  it('answers identically for known and unknown emails, storing only a hash', async function() {
    const agent = request.agent(app);
    let token = await getCsrfToken(agent, '/auth/forgot');
    const known = await post(agent, '/auth/forgot', { email: email.toUpperCase() }, token).expect(302);
    token = await getCsrfToken(agent, '/auth/forgot');
    const unknown = await post(agent, '/auth/forgot', { email: 'nobody@example.com' }, token).expect(302);
    if (known.headers.location !== unknown.headers.location) throw new Error('responses differ');

    await user.reload();
    if (!user.passwordResetToken || user.passwordResetToken.length !== 64) throw new Error('no hashed token stored');
    if (new Date(user.passwordResetExpiresAt) - Date.now() > 60 * 60 * 1000 + 5000) throw new Error('expiry longer than 1h');
  });

  it('rejects expired and unknown links', async function() {
    await issueToken('expired-token', -1000);
    await request(app).get('/auth/reset/expired-token').expect('Location', '/auth/forgot');
    await request(app).get('/auth/reset/not-a-real-token').expect('Location', '/auth/forgot');
    await request(app).get('/auth/reset').expect('Location', '/auth/forgot');
  });

  it('moves the token out of the URL, then requires matching passwords', async function() {
    await issueToken('good-token');
    const agent = request.agent(app);
    await agent.get('/auth/reset/good-token').expect('Location', '/auth/reset');
    const page = await agent.get('/auth/reset').expect(200);
    if (page.text.includes('good-token')) throw new Error('token rendered into the page');

    const token = await getCsrfToken(agent, '/auth/reset');
    await post(agent, '/auth/reset', { password: newPassword, confirm: 'different-123' }, token)
      .expect('Location', '/auth/reset');
    await user.reload();
    if (!user.validPassword(oldPassword)) throw new Error('password changed despite mismatch');
  });

  it('sets a hashed password, burns the token, verifies email and signs out old sessions', async function() {
    // A session logged in with the old password, before the reset
    await db.user.update({ emailVerified: true }, { where: { id: user.id } });
    const oldSession = request.agent(app);
    let token = await getCsrfToken(oldSession, '/auth/login');
    await post(oldSession, '/auth/login', { email, password: oldPassword }, token).expect('Location', '/');
    await oldSession.get('/garage').expect(200);
    await db.user.update({ emailVerified: false }, { where: { id: user.id } });

    await issueToken('final-token');
    const agent = request.agent(app);
    await agent.get('/auth/reset/final-token').expect(302);
    token = await getCsrfToken(agent, '/auth/reset');
    await post(agent, '/auth/reset', { password: newPassword, confirm: newPassword }, token)
      .expect('Location', '/auth/login');

    await user.reload();
    if (user.password === newPassword || !user.password.startsWith('$2')) throw new Error('password not hashed');
    if (!user.validPassword(newPassword)) throw new Error('new password does not work');
    if (user.validPassword(oldPassword)) throw new Error('old password still works');
    if (user.passwordResetToken !== null) throw new Error('token not burned');
    if (!user.emailVerified) throw new Error('email not marked verified');

    // Link can't be reused
    await request(app).get('/auth/reset/final-token').expect('Location', '/auth/forgot');
    // The pre-reset session is signed out
    await oldSession.get('/garage').expect('Location', '/auth/login');
  });
});
