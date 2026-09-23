'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_cars', 'vin', { type: Sequelize.STRING(17), allowNull: true });

    await queryInterface.createTable('maintenance_logs', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      userCarId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'user_cars', key: 'id' }, onDelete: 'CASCADE' },
      date:      { type: Sequelize.DATEONLY, allowNull: false },
      title:     { type: Sequelize.STRING, allowNull: false },
      mileage:   { type: Sequelize.INTEGER, allowNull: true },
      cost:      { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      notes:     { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('maintenance_logs', ['userCarId', 'date'], { name: 'maintenance_logs_usercarid_date_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('maintenance_logs');
    await queryInterface.removeColumn('user_cars', 'vin');
  }
};
