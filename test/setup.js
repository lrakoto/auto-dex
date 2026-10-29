// Root Mocha hooks (loaded via .mocharc.json "require").
// Resets the TEST database once per run using the real migrations, so the
// schema under test matches production exactly (indexes, uniques, cascades).
const db = require('../models');
const { runMigrations } = require('./helpers');

exports.mochaHooks = {
  async beforeAll() {
    await runMigrations(db.sequelize);
  },
  async afterAll() {
    await db.sequelize.close();
  }
};
