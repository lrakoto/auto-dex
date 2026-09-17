const request = require('supertest');
const app = require('../server');
const db = require('../models');

describe('SEO', function() {
  before(async function() {
    await db.car.findOrCreate({
      where: { make: 'Toyota', model: 'Supra' },
      defaults: { favcount: 3, updated_img: true, image: 'https://example.com/supra.jpg' }
    });
  });

  it('sets a per-page title and canonical on the home page', async function() {
    const res = await request(app).get('/').expect(200);
    if (!/<title>AutoDex — Car Database/.test(res.text)) throw new Error('home title missing');
    if (!/rel="canonical"/.test(res.text)) throw new Error('canonical missing');
    if (!/name="description"/.test(res.text)) throw new Error('meta description missing');
  });

  it('marks auth pages noindex', async function() {
    const res = await request(app).get('/auth/login').expect(200);
    if (!/name="robots" content="noindex/.test(res.text)) throw new Error('auth page not noindex');
  });

  it('titles the make page with the make name', async function() {
    const res = await request(app).get('/cars?selectmake=Toyota').expect(200);
    if (!/<title>Toyota Models/.test(res.text)) throw new Error('make title wrong');
  });

  it('serves a well-formed sitemap', async function() {
    const res = await request(app).get('/sitemap.xml').expect(200);
    if (!/application\/xml/.test(res.headers['content-type'])) throw new Error('wrong sitemap content-type');
    if (!res.text.startsWith('<?xml')) throw new Error('sitemap missing XML declaration');
    if (!res.text.includes('<urlset')) throw new Error('sitemap missing urlset');
    if (!res.text.includes('/cars/car?make=Toyota&amp;model=Supra')) {
      throw new Error('sitemap missing a known car URL');
    }
  });

  it('serves robots.txt', async function() {
    const res = await request(app).get('/robots.txt').expect(200);
    if (!/Sitemap:/.test(res.text)) throw new Error('robots.txt missing sitemap line');
    if (!/Disallow: \/garage\//.test(res.text)) throw new Error('robots.txt should disallow /garage/');
  });
});

describe('Page rendering (no inline scripts — CSP-safe)', function() {
  it('renders the car detail page without inline <script> blocks', async function() {
    const res = await request(app).get('/cars/car?make=Toyota&model=Supra').expect(200);
    const inline = res.text.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [];
    if (inline.length > 0) throw new Error(`found ${inline.length} inline script block(s)`);
    if (!/id="car-recent-data"/.test(res.text)) throw new Error('recently-viewed data element missing');
  });

  it('renders the add-car page without inline <script> blocks', async function() {
    const agent = request.agent(app);
    const { createVerifiedUser } = require('./helpers');
    await createVerifiedUser(agent, db, { email: 'render@example.com' });
    const res = await agent.get('/garage/add').expect(200);
    const inline = res.text.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [];
    if (inline.length > 0) throw new Error(`found ${inline.length} inline script block(s)`);
    if (!/\/js\/add-car\.js/.test(res.text)) throw new Error('external add-car script not referenced');
  });
});
