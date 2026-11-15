'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class spot_vote extends Model {
    static associate(models) {
      spot_vote.belongsTo(models.user, { foreignKey: 'userId', onDelete: 'CASCADE' });
      spot_vote.belongsTo(models.spotting, { foreignKey: 'spottingId', onDelete: 'CASCADE' });
    }
  }
  spot_vote.init({
    userId: { type: DataTypes.INTEGER, allowNull: false },
    spottingId: { type: DataTypes.INTEGER, allowNull: false },
    voteDay: { type: DataTypes.DATEONLY, allowNull: false }
  }, {
    sequelize,
    modelName: 'spot_vote',
    indexes: [
      { name: 'spot_votes_userid_voteday_unique', fields: ['userId', 'voteDay'], unique: true },
      { name: 'spot_votes_spottingid_voteday_idx', fields: ['spottingId', 'voteDay'] }
    ]
  });
  return spot_vote;
};
