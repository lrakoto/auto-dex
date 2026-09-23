'use strict';

const PLACEHOLDER_URL = 'https://i.ibb.co/PwkqdSy/placeholder.png';

// Per-car image gallery with community votes. cars.image stays the hero image
// (everything else reads it); it's re-pointed at the top-scored gallery image
// whenever votes change. Existing real images are backfilled as the first
// gallery entry so current heroes don't disappear.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('car_images', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      carId:     { type: Sequelize.INTEGER, allowNull: false, references: { model: 'cars', key: 'id' }, onDelete: 'CASCADE' },
      userId:    { type: Sequelize.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      url:       { type: Sequelize.TEXT, allowNull: false },
      source:    { type: Sequelize.STRING, allowNull: false, defaultValue: 'user' },
      score:     { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('car_images', ['carId', 'url'], { name: 'car_images_carid_url_unique', unique: true });

    await queryInterface.createTable('car_image_votes', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      imageId:   { type: Sequelize.INTEGER, allowNull: false, references: { model: 'car_images', key: 'id' }, onDelete: 'CASCADE' },
      userId:    { type: Sequelize.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      value:     { type: Sequelize.SMALLINT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('car_image_votes', ['imageId', 'userId'], { name: 'car_image_votes_imageid_userid_unique', unique: true });

    await queryInterface.sequelize.query(`
      INSERT INTO car_images ("carId", url, source, score, "createdAt", "updatedAt")
      SELECT id, image, 'catalog', 0, NOW(), NOW()
      FROM cars
      WHERE image IS NOT NULL AND image <> :placeholder
      ON CONFLICT DO NOTHING;
    `, { replacements: { placeholder: PLACEHOLDER_URL } });

    // Unsplash/CDN URLs can exceed 255 chars
    await queryInterface.changeColumn('image_proposals', 'imageUrl', { type: Sequelize.TEXT, allowNull: false });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('image_proposals', 'imageUrl', { type: Sequelize.STRING, allowNull: false });
    await queryInterface.dropTable('car_image_votes');
    await queryInterface.dropTable('car_images');
  }
};
