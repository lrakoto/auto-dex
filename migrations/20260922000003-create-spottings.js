'use strict';

// "Spotted it" check-ins — the Dex. A user may spot the same car many times;
// completion counts distinct carIds.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('spottings', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      userId:    { type: Sequelize.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      carId:     { type: Sequelize.INTEGER, allowNull: false, references: { model: 'cars', key: 'id' }, onDelete: 'CASCADE' },
      imageUrl:  { type: Sequelize.TEXT, allowNull: true },
      location:  { type: Sequelize.STRING, allowNull: true },
      notes:     { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('spottings', ['userId', 'carId'], { name: 'spottings_userid_carid_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('spottings');
  }
};
