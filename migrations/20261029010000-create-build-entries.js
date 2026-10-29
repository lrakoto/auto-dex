'use strict';

// Build log (R13): modifications on a garage car — part, vendor, cost, date,
// notes and an optional photo. Entries go with their car.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('build_entries', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      userCarId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'user_cars', key: 'id' }, onDelete: 'CASCADE' },
      date:      { type: Sequelize.DATEONLY, allowNull: false },
      part:      { type: Sequelize.STRING(160), allowNull: false },
      vendor:    { type: Sequelize.STRING(120), allowNull: true },
      cost:      { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      notes:     { type: Sequelize.TEXT, allowNull: true },
      imageUrl:  { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('build_entries', ['userCarId', 'date'], { name: 'build_entries_usercarid_date_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('build_entries');
  }
};
