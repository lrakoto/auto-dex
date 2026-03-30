'use strict';
const { Model } = require('sequelize');

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
    imageUrl: DataTypes.STRING,
    status:   { type: DataTypes.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' }
  }, {
    sequelize,
    modelName: 'image_proposal'
  });
  return image_proposal;
};
