'use strict';

// The placeholder photo was a hotlinked image reading "Unsplash Image API
// Limit Reached", shown on every car still waiting for a photo. Point those
// rows at the local /assets/no-photo.svg instead. Only `image` values change;
// no row is deleted.
//
// Favorites saved with the old placeholder are cleared rather than repointed:
// a favorite without its own photo shows the car's current one
// (lib/photos.js#favoritePhoto), so they pick up photos found since.
const OLD_URL = 'https://i.ibb.co/PwkqdSy/placeholder.png';
const NEW_URL = '/assets/no-photo.svg';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { replacements: { old: OLD_URL, new: NEW_URL }, transaction });
      await run('UPDATE cars SET image = :new WHERE image = :old');
      await run('UPDATE user_cars SET image = :new WHERE image = :old');
      await run('UPDATE favorite_cars SET image = NULL WHERE image = :old');
      await queryInterface.changeColumn('user_cars', 'image', { type: Sequelize.TEXT, defaultValue: NEW_URL }, { transaction });
    });
  },
  async down(queryInterface, Sequelize) {
    // Cleared favorites stay cleared: they show the car's photo either way
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { replacements: { old: OLD_URL, new: NEW_URL }, transaction });
      await run('UPDATE cars SET image = :old WHERE image = :new');
      await run('UPDATE user_cars SET image = :old WHERE image = :new');
      await queryInterface.changeColumn('user_cars', 'image', { type: Sequelize.TEXT, defaultValue: OLD_URL }, { transaction });
    });
  }
};
