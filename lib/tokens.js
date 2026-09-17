// Verification-token and email helpers.
//
// Tokens are emailed in plaintext (they have to be), but only their SHA-256
// hash is persisted. A database leak therefore cannot be replayed to verify
// an account. SHA-256 (not bcrypt) is correct here: the token is 256 bits of
// CSPRNG output, so it is not brute-forceable and we want lookups by hash.
const crypto = require('crypto');

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Emails are case-insensitive; store and compare a single canonical form so
// Foo@x.com and foo@x.com can't become two accounts.
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

module.exports = { generateVerificationToken, hashToken, normalizeEmail };
