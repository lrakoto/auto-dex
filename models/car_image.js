'use strict';
const { Model } = require('sequelize');

// Gallery image for a catalog car. cars.image is the hero and points at the
// top-scored row here (see lib/gallery.js).
module.exports = (sequelize, DataTypes) => {
  class car_image extends Model {
    static associate(models) {
      car_image.belongsTo(models.car,  { foreignKey: 'carId' });
      car_image.belongsTo(models.user, { foreignKey: 'userId' });
      car_image.hasMany(models.car_image_vote, { foreignKey: 'imageId' });
    }
  }
  car_image.init({
    carId:  { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    url:    { type: DataTypes.TEXT,    allowNull: false },
    source: { type: DataTypes.STRING,  allowNull: false, defaultValue: 'user' },
    score:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Photographer credit (Unsplash guidelines) — see lib/unsplash.js
    credit_name:    { type: DataTypes.TEXT },
    credit_url:     { type: DataTypes.TEXT },
    credit_checked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    sequelize,
    modelName: 'car_image'
  });
  return car_image;
};
