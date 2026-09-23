'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class car_image_vote extends Model {
    static associate(models) {
      car_image_vote.belongsTo(models.car_image, { foreignKey: 'imageId' });
      car_image_vote.belongsTo(models.user,      { foreignKey: 'userId' });
    }
  }
  car_image_vote.init({
    imageId: { type: DataTypes.INTEGER,  allowNull: false },
    userId:  { type: DataTypes.INTEGER,  allowNull: false },
    value:   { type: DataTypes.SMALLINT, allowNull: false, validate: { isIn: [[-1, 1]] } }
  }, {
    sequelize,
    modelName: 'car_image_vote'
  });
  return car_image_vote;
};
