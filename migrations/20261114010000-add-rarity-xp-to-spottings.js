'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      // Historical spots and writes from an older app can keep null awards.
      await queryInterface.addColumn('spottings', 'rarityXp', {
        type: Sequelize.SMALLINT,
        allowNull: true
      }, { transaction });
      // No scan or backfill of existing rows; enforce the award on new writes.
      await queryInterface.sequelize.query(
        'ALTER TABLE spottings ADD CONSTRAINT spottings_rarityxp_award CHECK ("rarityXp" IN (10, 20, 35, 50)) NOT VALID',
        { transaction }
      );
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('spottings', 'rarityXp');
  }
};
