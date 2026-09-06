'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Dedupe favorites before the unique index — the old findOrCreate race
    // created duplicate (userId, carId) rows. This is harmless: a duplicate
    // favorite is the same logical row twice. Keeps the oldest row.
    await queryInterface.sequelize.query(`
      DELETE FROM favorite_cars a
      USING favorite_cars b
      WHERE a."userId" = b."userId"
        AND a."carId" = b."carId"
        AND a.id > b.id;
    `);
    // NOTE: if users.email has real duplicates the migration will fail — that's
    // deliberate. Deleting user accounts automatically is not safe; inspect and
    // resolve manually, then re-run.

    await queryInterface.addIndex('users', ['email'], {
      name: 'users_email_unique',
      unique: true
    });
    await queryInterface.addIndex('cars', ['make', 'model'], {
      name: 'cars_make_model_idx'
    });
    await queryInterface.addIndex('favorite_cars', ['userId'], {
      name: 'favorite_cars_userid_idx'
    });
    await queryInterface.addIndex('favorite_cars', ['userId', 'carId'], {
      name: 'favorite_cars_userid_carid_unique',
      unique: true
    });
    await queryInterface.addIndex('user_cars', ['userId'], {
      name: 'user_cars_userid_idx'
    });
    await queryInterface.addIndex('image_proposals', ['status'], {
      name: 'image_proposals_status_idx'
    });
    await queryInterface.addIndex('image_proposals', ['carId'], {
      name: 'image_proposals_carid_idx'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('users', 'users_email_unique');
    await queryInterface.removeIndex('cars', 'cars_make_model_idx');
    await queryInterface.removeIndex('favorite_cars', 'favorite_cars_userid_idx');
    await queryInterface.removeIndex('favorite_cars', 'favorite_cars_userid_carid_unique');
    await queryInterface.removeIndex('user_cars', 'user_cars_userid_idx');
    await queryInterface.removeIndex('image_proposals', 'image_proposals_status_idx');
    await queryInterface.removeIndex('image_proposals', 'image_proposals_carid_idx');
  }
};
