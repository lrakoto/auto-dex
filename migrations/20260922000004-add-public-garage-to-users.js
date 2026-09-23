'use strict';

// Public garage pages live at /u/:username. Garages are private until the
// user picks a username AND flips garagePublic on.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'username', { type: Sequelize.STRING(30), allowNull: true });
    await queryInterface.addColumn('users', 'garagePublic', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false
    });
    await queryInterface.addIndex('users', ['username'], { name: 'users_username_unique', unique: true });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_username_unique');
    await queryInterface.removeColumn('users', 'garagePublic');
    await queryInterface.removeColumn('users', 'username');
  }
};
