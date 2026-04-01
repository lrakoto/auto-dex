'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'lastLoginAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'lastLoginAt');
  }
};
