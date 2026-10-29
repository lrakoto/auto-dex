'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class build_entry extends Model {
    static associate(models) {
      build_entry.belongsTo(models.user_car, { foreignKey: 'userCarId' });
    }
  }
  build_entry.init({
    userCarId: { type: DataTypes.INTEGER, allowNull: false },
    date:      { type: DataTypes.DATEONLY, allowNull: false },
    part:      { type: DataTypes.STRING(160), allowNull: false },
    vendor:    { type: DataTypes.STRING(120) },
    cost:      { type: DataTypes.DECIMAL(10, 2), validate: { min: 0 } },
    notes:     { type: DataTypes.TEXT },
    imageUrl:  { type: DataTypes.TEXT }
  }, {
    sequelize,
    modelName: 'build_entry'
  });
  return build_entry;
};
