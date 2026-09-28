'use strict';

// Best "Who's That Car?" streak (controllers/play.js). Streaks live in the
// session while playing; a signed-in player's record is kept here for the
// Car Whisperer badge and the leaderboard of public garages.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'quizBest', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 0
    });
    await queryInterface.addIndex('users', ['quizBest'], { name: 'users_quiz_best_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_quiz_best_idx');
    await queryInterface.removeColumn('users', 'quizBest');
  }
};
