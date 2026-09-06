const request = require('supertest');
const app = require('../server');

describe('App', function() {
  it('should return a 200 response on the home page', async function() {
    await request(app).get('/').expect(200);
  });

  it('should serve pages with security headers (helmet)', async function() {
    const res = await request(app).get('/');
    if (!res.headers['content-security-policy']) throw new Error('missing CSP header');
    if (!res.headers['x-content-type-options']) throw new Error('missing X-Content-Type-Options');
  });

  it('should return 404 for unknown routes', async function() {
    await request(app).get('/this-route-does-not-exist').expect(404);
  });
});
