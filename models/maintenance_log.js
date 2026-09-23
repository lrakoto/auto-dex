'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class maintenance_log extends Model {
    static associate(models) {
      maintenance_log.belongsTo(models.user_car, { foreignKey: 'userCarId' });
    }
  }
  maintenance_log.init({
    userCarId: { type: DataTypes.INTEGER, allowNull: false },
    date:      { type: DataTypes.DATEONLY, allowNull: false },
    title:     { type: DataTypes.STRING, allowNull: false, validate: { len: [1, 120] } },
    mileage:   { type: DataTypes.INTEGER, validate: { min: 0 } },
    cost:      { type: DataTypes.DECIMAL(10, 2), validate: { min: 0 } },
    notes:     { type: DataTypes.TEXT }
  }, {
    sequelize,
    modelName: 'maintenance_log'
  });
  return maintenance_log;
};
