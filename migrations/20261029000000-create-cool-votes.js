'use strict';

// Cool Wall (R10): one tier per user per car — 0 Seriously Uncool, 1 Uncool,
// 2 Cool, 3 Sub-Zero (lib/coolWall.js). Votes go when their user or car does.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cool_votes', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      userId:    { type: Sequelize.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      carId:     { type: Sequelize.INTEGER, allowNull: false, references: { model: 'cars', key: 'id' }, onDelete: 'CASCADE' },
      tier:      { type: Sequelize.SMALLINT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('cool_votes', ['userId', 'carId'], { name: 'cool_votes_userid_carid_unique', unique: true });
    await queryInterface.addIndex('cool_votes', ['carId'], { name: 'cool_votes_carid_idx' });
    await queryInterface.sequelize.query('ALTER TABLE cool_votes ADD CONSTRAINT cool_votes_tier_range CHECK (tier BETWEEN 0 AND 3)');
  },
  async down(queryInterface) {
    await queryInterface.dropTable('cool_votes');
  }
};
