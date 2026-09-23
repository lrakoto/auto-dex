// Error tracking (Sentry). Must be required before anything else in server.js
// so the SDK can instrument Express and http. A no-op unless SENTRY_DSN is set.
require('dotenv').config();
const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT, // set by Render on every deploy
    sendDefaultPii: false,  // no cookies, IPs or user emails leave the app
    tracesSampleRate: 0     // errors only; no performance tracing
  });
}

module.exports = Sentry;
