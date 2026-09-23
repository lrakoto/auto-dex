'use strict';

// Model years per catalog car, filled in by jobs/years.js from NHTSA's
// GetModelsForMakeYear. model_years is the exact list (production gaps are
// real: the Supra skips 1999–2019); year_min/year_max are its bounds for cheap
// sorting and range checks. years_checked marks rows whose make has been
// scanned, so a restart only rescans makes that picked up new models since.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cars', 'year_min', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('cars', 'year_max', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('cars', 'model_years', { type: Sequelize.ARRAY(Sequelize.INTEGER), allowNull: true });
    await queryInterface.addColumn('cars', 'years_checked', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false
    });
    await queryInterface.addIndex('cars', ['make', 'year_min', 'year_max'], { name: 'cars_make_years_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('cars', 'cars_make_years_idx');
    await queryInterface.removeColumn('cars', 'years_checked');
    await queryInterface.removeColumn('cars', 'model_years');
    await queryInterface.removeColumn('cars', 'year_max');
    await queryInterface.removeColumn('cars', 'year_min');
  }
};
