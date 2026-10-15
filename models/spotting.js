'use strict';
const { Model } = require('sequelize');
const { isRetiredPhoto } = require('../lib/photoPolicy');

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
    imageUrl: { type: DataTypes.TEXT, get() {
      const value = this.getDataValue('imageUrl');
      return isRetiredPhoto(value) ? null : value;
    } },
    location: { type: DataTypes.STRING, validate: { len: [0, 120] } },
    notes:    { type: DataTypes.TEXT }
  }, {
    sequelize,
    modelName: 'spotting'
  });
  return spotting;
};
