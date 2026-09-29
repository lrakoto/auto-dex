'use strict';

// What kind of vehicle each catalog row is: car (cars, SUVs, minivans,
// pickups), motorcycle, offroad or commercial. The catalog was seeded from
// NHTSA lists that mix all of them under one make. Null until
// jobs/vehicleTypes.js classifies the row.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cars', 'vehicle_type', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addIndex('cars', ['make', 'vehicle_type'], { name: 'cars_make_vehicle_type_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('cars', 'cars_make_vehicle_type_idx');
    await queryInterface.removeColumn('cars', 'vehicle_type');
  }
};
