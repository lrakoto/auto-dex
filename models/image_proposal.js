'use strict';
const { Model } = require('sequelize');
const { displayPhoto } = require('../lib/photoPolicy');

module.exports = (sequelize, DataTypes) => {
  class image_proposal extends Model {
    static associate(models) {
      models.image_proposal.belongsTo(models.car,  { foreignKey: 'carId' });
      models.image_proposal.belongsTo(models.user, { foreignKey: 'userId' });
    }
  }
  image_proposal.init({
    carId:    DataTypes.INTEGER,
    userId:   DataTypes.INTEGER,
    imageUrl: { type: DataTypes.STRING, get() { return displayPhoto(this.getDataValue('imageUrl')); } },
    status:   { type: DataTypes.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' }
  }, {
    sequelize,
    modelName: 'image_proposal'
  });
  return image_proposal;
};
