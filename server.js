require('dotenv').config();
const express = require('express');
const layouts = require('express-ejs-layouts');
const app = express();
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('connect-flash');
const passport = require('./config/ppConfig');
const isLoggedIn = require('./middleware/isLoggedIn');
const methodOverride = require('method-override');
const { csrfSync } = require('csrf-sync');

// Fail loudly at boot instead of serving broken sessions
if (!process.env.SECRET_SESSION) {
  throw new Error('SECRET_SESSION env var is required (see CLAUDE.md — note the name, not SESSION_SECRET)');
}

// Background jobs (Unsplash updater, make seeder) only run when this file is
// executed directly (node server.js / PM2 / nodemon) — never when required by
// the test suite. Set ENABLE_BACKGROUND_JOBS=false to disable them explicitly
// (e.g. if you move them to a separate cron later).
const IS_MAIN = require.main === module;
if (IS_MAIN && process.env.ENABLE_BACKGROUND_JOBS !== 'false' && process.env.NODE_ENV !== 'test') {
  require('./jobs').startBackgroundJobs();
}

app.set('view engine', 'ejs');
app.set('trust proxy', 1); // Required for secure cookies behind a reverse proxy

// Security headers (helmet). CSP is configured around the resources this app
// actually loads: Bootstrap/Popper/jQuery from jsdelivr & code.jquery.com,
// Inter from Google Fonts, car images from arbitrary https hosts.
app.use(require('helmet')({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://code.jquery.com', 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'https:', 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(require('morgan')(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(methodOverride('_method'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/public'));
app.use(layouts);

// In production, keep sessions in Postgres so they survive restarts and deploys.
// The default MemoryStore drops every session on restart and leaks memory.
const sessionStore = process.env.NODE_ENV === 'production'
  ? new pgSession({
      conObject: {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      },
      tableName: 'session',
      createTableIfMissing: true
    })
  : undefined;

app.use(session({
  store: sessionStore,
  secret: process.env.SECRET_SESSION,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

// CSRF protection (csrf-sync, the maintained csurf successor).
// Token is read from the x-csrf-token header, the _csrf body field, or _csrf
// query param (multipart forms need the query param — multer parses the body
// per-route, after this middleware has already run).
const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) =>
    req.headers['x-csrf-token'] ||
    (req.body && req.body._csrf) ||
    req.query._csrf
});
app.use(csrfSynchronisedProtection);

app.use((req, res, next) => {
  res.locals.alerts = req.flash();
  res.locals.currentUser = req.user;
  res.locals.csrfToken = generateToken(req);
  next();
});

// Routes
app.use('/', require('./controllers/home'));     // /, /suggest, /search, /makes
app.use('/auth', require('./controllers/auth'));
app.use('/cars', require('./controllers/cars'));
app.use('/garage', isLoggedIn, require('./controllers/garage'));

// Error handler — multer rejects oversize files and csrf-sync rejects bad tokens
// before route handlers run, so turn those into friendly flashes, not bare 500s
app.use((err, req, res, next) => {
  const { MulterError } = require('multer');
  const isMulter = err instanceof MulterError;
  const isCsrf = err.code === 'EBADCSRFTOKEN';
  if (!isMulter && !isCsrf) {
    console.log('UNHANDLED ERROR:', err);
    return res.status(500).send('Something went wrong.');
  }

  const msg = isCsrf
    ? 'That form expired — please try again.'
    : err.code === 'LIMIT_FILE_SIZE'
      ? 'That image is too large — 5 MB max.'
      : 'Upload failed. Please try another image.';
  req.flash('error', msg);

  // Redirect back to the referring page, but only if it's same-origin
  let target = '/';
  const referrer = req.get('Referrer');
  if (referrer) {
    try {
      if (new URL(referrer).host === req.headers.host) target = referrer;
    } catch (e) { /* not a URL — use '/' */ }
  }
  // AJAX callers get JSON instead of a redirect
  if (req.get('X-Requested-With') === 'XMLHttpRequest') {
    return res.status(isCsrf ? 403 : 400).json({ success: false, error: msg });
  }
  res.redirect(target);
});

// 404 Handler
app.use((req, res, next) => {
  res.status(404).render('404');
});

// Only bind a port when run directly (node server.js / PM2 / nodemon).
// The test suite requires this module and passes the app to supertest —
// no listener, no timers, no background jobs.
if (IS_MAIN) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🎧 You're listening to the smooth sounds of port ${PORT} 🎧`);
  });
}

module.exports = app;
