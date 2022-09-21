'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class favorite_car extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      models.favorite_car.belongsToMany(models.user);
      models.favorite_car.hasMany(models.car);
    }
  }
  favorite_car.init({
    carId: DataTypes.INTEGER,
    userId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'favorite_car',
  });
  return favorite_car;
};