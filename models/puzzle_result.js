'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class puzzle_result extends Model {
    static associate(models) {
      puzzle_result.belongsTo(models.user, { foreignKey: 'userId', onDelete: 'CASCADE' });
    }
  }
  puzzle_result.init({
    userId: { type: DataTypes.INTEGER, allowNull: false },
    puzzleDate: { type: DataTypes.DATEONLY, allowNull: false },
    guessCount: { type: DataTypes.SMALLINT, allowNull: true, validate: { isInt: true, min: 1, max: 6 } }
  }, {
    sequelize,
    modelName: 'puzzle_result',
    indexes: [{ name: 'puzzle_results_userid_puzzledate_unique', fields: ['userId', 'puzzleDate'], unique: true }]
  });
  return puzzle_result;
};
