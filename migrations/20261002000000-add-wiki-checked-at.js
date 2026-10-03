'use strict';

// When the photo job last asked Wikipedia about a car. Cars it had nothing
// for are asked again a month later (jobs/images.js#wikipediaPhotos). Rows
// already checked count as checked now, so the first re-checks start in a
// month rather than all at once.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('cars', 'wiki_checked_at', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.sequelize.query('UPDATE cars SET wiki_checked_at = NOW() WHERE wiki_checked', { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('cars', 'wiki_checked_at');
  }
};
