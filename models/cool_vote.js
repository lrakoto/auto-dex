'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class cool_vote extends Model {
    static associate(models) {
      cool_vote.belongsTo(models.user, { foreignKey: 'userId' });
      cool_vote.belongsTo(models.car,  { foreignKey: 'carId' });
    }
  }
  cool_vote.init({
    userId: { type: DataTypes.INTEGER,  allowNull: false },
    carId:  { type: DataTypes.INTEGER,  allowNull: false },
    tier:   { type: DataTypes.SMALLINT, allowNull: false, validate: { isIn: [[0, 1, 2, 3]] } }
  }, {
    sequelize,
    modelName: 'cool_vote'
  });
  return cool_vote;
};
