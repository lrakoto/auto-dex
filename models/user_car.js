'use strict';
const { Model } = require('sequelize');
const { PLACEHOLDER_URL } = require('../lib/constants');

module.exports = (sequelize, DataTypes) => {
  class user_car extends Model {
    static associate(models) {
      user_car.belongsTo(models.user, { foreignKey: 'userId' });
      user_car.hasMany(models.maintenance_log, { foreignKey: 'userCarId' });
    }
  }
  user_car.init({
    userId:  { type: DataTypes.INTEGER, allowNull: false },
    make:    { type: DataTypes.STRING,  allowNull: false },
    model:   { type: DataTypes.STRING,  allowNull: false },
    year:    { type: DataTypes.STRING,  allowNull: false },
    image:   { type: DataTypes.TEXT,    defaultValue: PLACEHOLDER_URL },
    notes:   { type: DataTypes.TEXT },
    vin:     { type: DataTypes.STRING(17) }
  }, {
    sequelize,
    modelName: 'user_car'
  });
  return user_car;
};
