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
      models.car.hasMany(models.favorite_car);
      models.car.hasMany(models.image_proposal, { foreignKey: 'carId' });
      models.car.hasMany(models.car_image, { foreignKey: 'carId' });
      models.car.hasMany(models.spotting, { foreignKey: 'carId' });
    }
  }
  car.init({
    make: DataTypes.STRING,
    model: DataTypes.STRING,
    year: DataTypes.INTEGER,
    image: DataTypes.STRING,
    favcount: DataTypes.INTEGER,
    updated_img: DataTypes.BOOLEAN,
    year_min: DataTypes.INTEGER,
    year_max: DataTypes.INTEGER,
    model_years: DataTypes.ARRAY(DataTypes.INTEGER),
    years_checked: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, {
    sequelize,
    modelName: 'car',
  });
  return car;
};