'use strict';

// Password reset: hashed single-use token + expiry (same scheme as email
// verification — see lib/tokens.js), and sessionVersion, bumped on reset so
// every session created before the reset is signed out.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'passwordResetToken', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('users', 'passwordResetExpiresAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('users', 'sessionVersion', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 0
    });
    await queryInterface.addIndex('users', ['passwordResetToken'], { name: 'users_password_reset_token_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_password_reset_token_idx');
    await queryInterface.removeColumn('users', 'sessionVersion');
    await queryInterface.removeColumn('users', 'passwordResetExpiresAt');
    await queryInterface.removeColumn('users', 'passwordResetToken');
  }
};
