// Shared test helpers — CSRF extraction and a migration-based DB reset.

const { execFileSync } = require('child_process');
const path = require('path');

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  if (!m) throw new Error('No _csrf hidden input found in page — template regression?');
  return m[1];
}

// GET a form page with the agent (keeping the session cookie), return its CSRF token
async function getCsrfToken(agent, path = '/auth/login') {
  const res = await agent.get(path).expect(200);
  return extractCsrf(res.text);
}

// Reset the TEST database by running the real migrations. Using the migrations
// (not sequelize.sync) means indexes, unique constraints and FK cascades are
// actually exercised — sync({ force: true }) silently skipped them all.
function runMigrations() {
  execFileSync(
    path.join(__dirname, '..', 'node_modules', '.bin', 'sequelize-cli'),
    ['db:migrate:undo:all', '--env', 'test'],
    { cwd: path.join(__dirname, '..'), stdio: 'pipe', env: { ...process.env, NODE_ENV: 'test' } }
  );
  execFileSync(
    path.join(__dirname, '..', 'node_modules', '.bin', 'sequelize-cli'),
    ['db:migrate', '--env', 'test'],
    { cwd: path.join(__dirname, '..'), stdio: 'pipe', env: { ...process.env, NODE_ENV: 'test' } }
  );
}

// Create a verified, logged-in user on an agent. Returns the user row.
async function createVerifiedUser(agent, db, { email, name = 'Test User', password = 'password123' } = {}) {
  const token = await getCsrfToken(agent, '/auth/signup');
  await agent.post('/auth/signup')
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .send({ email, name, password, _csrf: token })
    .expect(302);

  await db.user.update({ emailVerified: true }, { where: { email } });

  const loginToken = await getCsrfToken(agent);
  await agent.post('/auth/login')
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .send({ email, password, _csrf: loginToken })
    .expect(302);

  return db.user.findOne({ where: { email } });
}

module.exports = { extractCsrf, getCsrfToken, runMigrations, createVerifiedUser };
