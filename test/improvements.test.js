const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { PLACEHOLDER_URL } = require('../lib/constants');
const unsplash = require('../lib/unsplash');

describe('Improvements', function() {
  describe('Unsplash helpers', function() {
    it('serves Unsplash hotlinks at display size and leaves other hosts alone', function() {
      const full = 'https://images.unsplash.com/photo-123-abc?crop=entropy&fm=jpg&q=85';
      const sized = new URL(unsplash.sizedUrl(full));
      if (sized.searchParams.get('w') !== '1080' || sized.searchParams.get('q') !== '80') throw new Error('not resized');
      if (sized.pathname !== '/photo-123-abc') throw new Error('photo changed');
      const other = 'https://res.cloudinary.com/x/image/upload/a.jpg';
      if (unsplash.sizedUrl(other) !== other) throw new Error('non-Unsplash URL modified');
      if (!unsplash.samePhoto(full, sized.toString())) throw new Error('same photo not recognised');
    });

    it('builds photographer credit with utm parameters', function() {
      const credit = unsplash.creditFor({ user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane' } } });
      if (credit.creditName !== 'Jane Doe') throw new Error('name missing');
      if (credit.creditUrl !== 'https://unsplash.com/@jane?utm_source=autodex&utm_medium=referral') throw new Error('bad credit url: ' + credit.creditUrl);
    });
  });

  describe('credit backfill', function() {
    const { backfillCredits } = require('../jobs/images');
    let realSearch;
    before(function() { realSearch = unsplash.searchCarPhoto; });
    after(function() { unsplash.searchCarPhoto = realSearch; });

    it('credits old Unsplash images when the search still returns that photo', async function() {
      const matchCar = await db.car.create({ make: 'Saab', model: '900', favcount: 0, updated_img: true, image: PLACEHOLDER_URL });
      const missCar = await db.car.create({ make: 'Saab', model: '9000', favcount: 0, updated_img: true, image: PLACEHOLDER_URL });
      const matched = await db.car_image.create({ carId: matchCar.id, url: 'https://images.unsplash.com/photo-900?w=1080', source: 'catalog' });
      const missed = await db.car_image.create({ carId: missCar.id, url: 'https://images.unsplash.com/photo-9000?w=1080', source: 'unsplash' });

      unsplash.searchCarPhoto = async (make, model) => ({
        urls: { full: model === '900' ? 'https://images.unsplash.com/photo-900?q=85' : 'https://images.unsplash.com/photo-other' },
        user: { name: 'Saab Fan', links: { html: 'https://unsplash.com/@saabfan' } }
      });
      await backfillCredits(10);

      await matched.reload();
      await missed.reload();
      if (matched.credit_name !== 'Saab Fan' || !matched.credit_checked) throw new Error('matching photo not credited');
      if (missed.credit_name !== null || !missed.credit_checked) throw new Error('non-matching photo should be checked, uncredited');
    });
  });

  describe('GET /cars/explore', function() {
    before(async function() {
      await db.car.bulkCreate([
        { make: 'Nissan', model: 'Skyline GT-R', favcount: 9, updated_img: true, image: 'https://example.com/r32.jpg', model_years: [1989, 1990, 1991, 1992, 1993, 1994], year_min: 1989, year_max: 1994, years_checked: true },
        { make: 'Nissan', model: 'Leaf', favcount: 1, updated_img: false, image: PLACEHOLDER_URL, model_years: [2011, 2012], year_min: 2011, year_max: 2012, years_checked: true },
        { make: 'Ford', model: 'Probe', favcount: 2, updated_img: true, image: 'https://example.com/probe.jpg', model_years: [1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997], year_min: 1989, year_max: 1997, years_checked: true }
      ], { ignoreDuplicates: true });
    });

    it('filters by decade and country of origin', async function() {
      const res = await request(app).get('/cars/explore?decade=1990&country=Japan').expect(200);
      if (!res.text.includes('Skyline GT-R')) throw new Error('90s Japanese car missing');
      if (res.text.includes('>Leaf<')) throw new Error('2010s car leaked into 1990s');
      if (res.text.includes('>Probe<')) throw new Error('American car leaked into Japan');
      if (!/name="robots" content="noindex/.test(res.text)) throw new Error('filtered view should be noindex');
    });

    it('can hide placeholder-image cars and ignores bogus filter values', async function() {
      const res = await request(app).get('/cars/explore?make=Nissan&photos=1&decade=1234&country=Atlantis&sort=drop').expect(200);
      if (!res.text.includes('Skyline GT-R')) throw new Error('photo car missing');
      if (res.text.includes('>Leaf<')) throw new Error('placeholder car shown with photos=1');
    });

    it('uses an absolute favorite action so it works under /cars/', async function() {
      const res = await request(app).get('/cars/explore?make=Nissan').expect(200);
      if (/action="cars\/fav"/.test(res.text)) throw new Error('relative fav action');
    });
  });

  describe('photo credits on the detail page', function() {
    it('credits Unsplash photos even before a photographer is known', async function() {
      await db.car.create({
        make: 'Subaru', model: 'SVX', favcount: 0, updated_img: true,
        image: 'https://images.unsplash.com/photo-svx?w=1080'
      });
      const res = await request(app).get('/cars/car?make=Subaru&model=SVX').expect(200);
      if (!/Photo from <a href="https:\/\/unsplash.com\/\?utm_source=autodex&amp;utm_medium=referral"/.test(res.text)) {
        throw new Error('generic Unsplash credit missing');
      }
    });
  });
});
