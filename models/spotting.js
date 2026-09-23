'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class spotting extends Model {
    static associate(models) {
      spotting.belongsTo(models.user, { foreignKey: 'userId' });
      spotting.belongsTo(models.car,  { foreignKey: 'carId' });
    }
  }
  spotting.init({
    userId:   { type: DataTypes.INTEGER, allowNull: false },
    carId:    { type: DataTypes.INTEGER, allowNull: false },
    imageUrl: { type: DataTypes.TEXT },
    location: { type: DataTypes.STRING, validate: { len: [0, 120] } },
    notes:    { type: DataTypes.TEXT }
  }, {
    sequelize,
    modelName: 'spotting'
  });
  return spotting;
};
