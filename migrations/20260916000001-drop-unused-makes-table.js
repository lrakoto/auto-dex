'use strict';

// The `makes` table predates the static MAKES_LIST in config/carquery.js and
// has had no reads or writes since (its model and seeder were removed along
// with it). Drops the table to stop it showing up as mystery state.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.dropTable('makes');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('makes', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      make: { type: Sequelize.STRING },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
  }
};
