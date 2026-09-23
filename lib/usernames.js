// Public garage handles: /u/:username
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

// Handles that would read as official or collide with routes
const RESERVED = new Set([
  'admin', 'administrator', 'autodex', 'garage', 'support', 'help', 'api', 'auth',
  'login', 'logout', 'signup', 'settings', 'root', 'staff', 'moderator', 'system'
]);

function validateUsername(input) {
  const u = String(input || '').trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return { ok: false, error: 'Usernames are 3–30 characters: letters, numbers and underscores.' };
  if (RESERVED.has(u)) return { ok: false, error: 'That username is reserved.' };
  return { ok: true, username: u };
}

module.exports = { validateUsername };
