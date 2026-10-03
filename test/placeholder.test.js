const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { createVerifiedUser } = require('./helpers');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { favoritePhoto } = require('../lib/photos');
const migration = require('../migrations/20261001000000-replace-placeholder-photo');

const OLD_URL = 'https://i.ibb.co/PwkqdSy/placeholder.png';

describe('Placeholder photo', function() {
  const agent = request.agent(app);
  let user;

  before(async function() {
    user = await createVerifiedUser(agent, db, { email: 'placeholder@example.com', name: 'Pat' });
  });

  it('is served locally as an SVG', async function() {
    if (PLACEHOLDER_URL !== '/assets/no-photo.svg') throw new Error('constant not pointed at the local asset');
    const res = await request(app).get(PLACEHOLDER_URL).expect(200);
    if (!/image\/svg\+xml/.test(res.headers['content-type'])) throw new Error(`wrong type: ${res.headers['content-type']}`);
  });

  it('migration repoints old placeholder rows without deleting any', async function() {
    const car = await db.car.create({ make: 'Bristol', model: 'Fighter', image: OLD_URL, favcount: 1, updated_img: false });
    const photoCar = await db.car.create({ make: 'Bristol', model: '411', image: 'https://example.com/411.jpg', favcount: 0, updated_img: true });
    const mine = await db.user_car.create({ userId: user.id, make: 'Bristol', model: 'Fighter', year: '2004', image: OLD_URL });
    const fav = await db.favorite_car.create({ userId: user.id, carId: car.id, make: 'Bristol', model: 'Fighter', image: OLD_URL });
    const carsBefore = await db.car.count();

    await migration.up(db.sequelize.getQueryInterface(), db.Sequelize);

    await car.reload(); await photoCar.reload(); await mine.reload(); await fav.reload();
    if (car.image !== PLACEHOLDER_URL) throw new Error(`car not repointed: ${car.image}`);
    if (photoCar.image !== 'https://example.com/411.jpg') throw new Error('real photo touched');
    if (mine.image !== PLACEHOLDER_URL) throw new Error(`garage car not repointed: ${mine.image}`);
    if (fav.image !== null) throw new Error('favorite placeholder not cleared');
    if (await db.car.count() !== carsBefore) throw new Error('rows deleted');

    // The column default changed too (a raw insert skips the model default)
    await db.sequelize.query(
      'INSERT INTO user_cars ("userId", make, model, year, "createdAt", "updatedAt") VALUES (:id, \'Bristol\', \'603\', \'1977\', NOW(), NOW())',
      { replacements: { id: user.id } }
    );
    const [[row]] = await db.sequelize.query('SELECT image FROM user_cars WHERE model = \'603\'');
    if (row.image !== PLACEHOLDER_URL) throw new Error(`column default not updated: ${row.image}`);
  });

  it('a favorite without its own photo shows the car\'s current one', async function() {
    const car = await db.car.create({ make: 'Bristol', model: 'Blenheim', image: 'https://example.com/blenheim.jpg', favcount: 1, updated_img: true });
    await db.favorite_car.create({ userId: user.id, carId: car.id, make: 'Bristol', model: 'Blenheim', image: null });
    const res = await agent.get('/garage').expect(200);
    if (!res.text.includes('src="https://example.com/blenheim.jpg"')) throw new Error('car photo not shown on the favorite');
    if (res.text.includes('&image=null')) throw new Error('empty favorite image leaked into the link');
  });

  it('favoritePhoto prefers the user\'s pick, then the car, then the placeholder', function() {
    const car = { image: 'https://example.com/car.jpg' };
    if (favoritePhoto({ image: 'https://example.com/mine.jpg', car }) !== 'https://example.com/mine.jpg') throw new Error('own pick ignored');
    if (favoritePhoto({ image: PLACEHOLDER_URL, car }) !== car.image) throw new Error('placeholder pick should fall through');
    if (favoritePhoto({ image: null, car }) !== car.image) throw new Error('car photo not used');
    if (favoritePhoto({ image: null, car: null }) !== PLACEHOLDER_URL) throw new Error('no placeholder fallback');
  });
});
