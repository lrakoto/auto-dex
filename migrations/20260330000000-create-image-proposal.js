'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('image_proposals', {
      id:        { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      carId:     { type: Sequelize.INTEGER, allowNull: false, references: { model: 'cars', key: 'id' }, onDelete: 'CASCADE' },
      userId:    { type: Sequelize.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      imageUrl:  { type: Sequelize.STRING, allowNull: false },
      status:    { type: Sequelize.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('image_proposals');
  }
};
