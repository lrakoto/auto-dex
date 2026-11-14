'use strict';

// Store a signed-in user's first completed result for a UTC puzzle date.
// A null guess count is a loss; a win records the number of guesses.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.createTable('puzzle_results', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        userId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE'
        },
        puzzleDate: { type: Sequelize.DATEONLY, allowNull: false },
        guessCount: { type: Sequelize.SMALLINT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false }
      }, { transaction });
      await queryInterface.addIndex('puzzle_results', ['userId', 'puzzleDate'], {
        name: 'puzzle_results_userid_puzzledate_unique',
        unique: true,
        transaction
      });
      await queryInterface.sequelize.query(
        'ALTER TABLE puzzle_results ADD CONSTRAINT puzzle_results_guesscount_range CHECK ("guessCount" BETWEEN 1 AND 6)',
        { transaction }
      );
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('puzzle_results');
  }
};
