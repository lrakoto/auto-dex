'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('fuel_logs', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      userCarId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'user_cars', key: 'id' }, onDelete: 'CASCADE' },
      date:      { type: Sequelize.DATEONLY, allowNull: false },
      odometer:  { type: Sequelize.INTEGER, allowNull: false },
      gallons:   { type: Sequelize.DECIMAL(6, 3), allowNull: false },
      cost:      { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      notes:     { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('fuel_logs', ['userCarId', 'odometer'], { name: 'fuel_logs_usercarid_odometer_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('fuel_logs');
  }
};
