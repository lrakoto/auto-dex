// Shared test helpers — CSRF token extraction for form POSTs through supertest.

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

module.exports = { extractCsrf, getCsrfToken };
