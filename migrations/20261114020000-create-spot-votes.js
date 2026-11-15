'use strict';

// One vote per account per UTC calendar day; votes disappear with their
// voter or the sighting that received them.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.createTable('spot_votes', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        userId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE'
        },
        spottingId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: 'spottings', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE'
        },
        voteDay: { type: Sequelize.DATEONLY, allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false }
      }, { transaction });
      await queryInterface.addIndex('spot_votes', ['userId', 'voteDay'], {
        name: 'spot_votes_userid_voteday_unique',
        unique: true,
        transaction
      });
      await queryInterface.addIndex('spot_votes', ['spottingId', 'voteDay'], {
        name: 'spot_votes_spottingid_voteday_idx',
        transaction
      });
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('spot_votes');
  }
};
