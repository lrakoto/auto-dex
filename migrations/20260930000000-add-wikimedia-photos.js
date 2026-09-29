'use strict';

// Photos from Wikipedia (R2). cars.wiki_checked marks rows the photo job has
// looked up on Wikipedia; car_images gains the license that the credit line
// under a Wikimedia Commons photo has to show.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('cars', 'wiki_checked', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, { transaction });
      await queryInterface.addColumn('car_images', 'license', { type: Sequelize.TEXT, allowNull: true }, { transaction });
      await queryInterface.addColumn('car_images', 'license_url', { type: Sequelize.TEXT, allowNull: true }, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('car_images', 'license_url');
    await queryInterface.removeColumn('car_images', 'license');
    await queryInterface.removeColumn('cars', 'wiki_checked');
  }
};
