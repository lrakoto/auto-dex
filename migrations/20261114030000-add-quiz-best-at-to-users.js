'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Historical bests keep their score but have no recorded achievement date.
    await queryInterface.addColumn('users', 'quizBestAt', {
      type: Sequelize.DATE, allowNull: true
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'quizBestAt');
  }
};
