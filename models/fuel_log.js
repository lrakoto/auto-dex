'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class fuel_log extends Model {
    static associate(models) {
      fuel_log.belongsTo(models.user_car, { foreignKey: 'userCarId' });
    }
  }
  fuel_log.init({
    userCarId: { type: DataTypes.INTEGER, allowNull: false },
    date:      { type: DataTypes.DATEONLY, allowNull: false },
    odometer:  { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0 } },
    gallons:   { type: DataTypes.DECIMAL(6, 3), allowNull: false, validate: { min: 0.001 } },
    cost:      { type: DataTypes.DECIMAL(10, 2), validate: { min: 0 } },
    notes:     { type: DataTypes.TEXT }
  }, {
    sequelize,
    modelName: 'fuel_log'
  });
  return fuel_log;
};
