const assert = require('node:assert/strict');
const db = require('../models');
const { getGallery } = require('../lib/gallery');
const { applyVerifiedCatalogPhotos } = require('../jobs/images');

describe('Verified Chevrolet Caprice cover', function() {
  it('replaces the police photo only on the civilian listing and credits the coupe photo', async function() {
    const commons = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
    const policeFile = '2011_Chevrolet_Caprice_PPV_--_12-06-2010_front.jpg';
    const coupeFile = '1969_Chevrolet_Caprice_%284847268053%29.jpg';
    const policePhoto = `${commons}0/00/${policeFile}/1280px-${policeFile}`;
    const coupePhoto = `${commons}9/90/${coupeFile}/1280px-${coupeFile}`;
    const [caprice, police] = await db.car.bulkCreate(['Caprice', 'Caprice Police Vehicle'].map(model => ({
      make: 'Chevrolet', model, image: policePhoto, updated_img: true
    })));

    try {
      await db.car_image.bulkCreate([caprice, police].map(car => ({
        carId: car.id, url: policePhoto, source: 'wikimedia'
      })));
      await applyVerifiedCatalogPhotos();

      assert.equal((await caprice.reload()).image, coupePhoto);
      const [replacement, ...others] = await getGallery(caprice);
      assert.deepEqual(others, []);
      assert.equal(replacement.url, coupePhoto);
      assert.equal(replacement.credit_name, 'dave_7');
      assert.equal(replacement.credit_url, `https://commons.wikimedia.org/wiki/File:${coupeFile}`);
      assert.equal(replacement.license_url, 'https://creativecommons.org/licenses/by/2.0/');
      assert.ok(await db.car_image.findOne({ where: { carId: caprice.id, url: policePhoto } }));

      assert.equal((await police.reload()).image, policePhoto);
      assert.deepEqual((await getGallery(police)).map(photo => photo.url), [policePhoto]);
    } finally {
      await db.car.destroy({ where: { id: [caprice.id, police.id] } });
    }
  });
});
