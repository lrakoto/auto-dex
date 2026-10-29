const assert = require('node:assert/strict');
const { runMigrations } = require('./helpers');

describe('Test database reset', function() {
  // A stand-in connection: the guard must refuse before any query runs
  const fakeDb = database => ({
    config: { database },
    query: async () => { throw new Error('the guard let a query through'); }
  });

  it('refuses to empty anything but a *_test database', async function() {
    for (const name of ['autodex', 'autodex_production', 'test', '', undefined]) {
      await assert.rejects(runMigrations(fakeDb(name)), /Refusing to reset database/, `accepted "${name}"`);
    }
  });

  it('rethrows anything but a missing-privilege error from the schema reset', async function() {
    const failing = { config: { database: 'autodex_test' }, query: async () => { throw Object.assign(new Error('boom'), { original: { code: '57P01' } }); } };
    await assert.rejects(runMigrations(failing), /boom/);
  });

  it('refuses outside NODE_ENV=test, even for a *_test database', async function() {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      await assert.rejects(runMigrations(fakeDb('autodex_test')), /Refusing to reset database/);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});
