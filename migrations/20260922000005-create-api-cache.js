'use strict';

// Durable backing store for lib/cache.js so external lookups (Wikipedia,
// Wikidata, FuelEconomy, NHTSA recalls) survive restarts and deploys instead
// of re-fetching on the first view of every car.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('api_cache', {
      key:       { type: Sequelize.TEXT, primaryKey: true },
      data:      { type: Sequelize.JSONB, allowNull: true },
      notFound:  { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      fetchedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('api_cache', ['fetchedAt'], { name: 'api_cache_fetchedat_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('api_cache');
  }
};
