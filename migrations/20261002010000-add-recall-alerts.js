'use strict';

// Recall alerts (R5): owners opt in on the garage page; a daily job emails
// them recalls NHTSA has added for their garage cars since the last check.
// recalls_seen is null until a car's first check, which only records what's
// already out (the car page shows those), so nobody is emailed old news.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('users', 'recallAlerts', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, { transaction });
      await queryInterface.addColumn('user_cars', 'recalls_seen', { type: Sequelize.ARRAY(Sequelize.TEXT), allowNull: true }, { transaction });
      await queryInterface.addColumn('user_cars', 'recalls_checked_at', { type: Sequelize.DATE, allowNull: true }, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('user_cars', 'recalls_checked_at');
    await queryInterface.removeColumn('user_cars', 'recalls_seen');
    await queryInterface.removeColumn('users', 'recallAlerts');
  }
};
