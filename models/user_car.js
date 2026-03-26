'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class user_car extends Model {
    static associate(models) {
      user_car.belongsTo(models.user, { foreignKey: 'userId' });
    }
  }
  user_car.init({
    userId:  { type: DataTypes.INTEGER, allowNull: false },
    make:    { type: DataTypes.STRING,  allowNull: false },
    model:   { type: DataTypes.STRING,  allowNull: false },
    year:    { type: DataTypes.STRING,  allowNull: false },
    image:   { type: DataTypes.TEXT,    defaultValue: 'https://i.ibb.co/PwkqdSy/placeholder.png' },
    notes:   { type: DataTypes.TEXT }
  }, {
    sequelize,
    modelName: 'user_car'
  });
  return user_car;
};
