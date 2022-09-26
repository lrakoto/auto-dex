'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class car extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      models.car.hasMany(models.favorite_car)
    }
  }
  car.init({
    make: DataTypes.STRING,
    model: DataTypes.STRING,
    year: DataTypes.INTEGER,
    type: DataTypes.STRING,
    image: DataTypes.STRING,
    favcount: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'car',
  });
  return car;
};