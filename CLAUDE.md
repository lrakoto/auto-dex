# AutoDex — Project Context for Claude

## What This Is
AutoDex is a car browsing and garage management web app. Users can browse cars by make/model, favorite them, add their own cars to a personal garage, and propose images for placeholder cars. Admins can approve image proposals, verify users, and manage the catalog.

## Stack
- **Backend**: Node.js + Express, EJS templates (no React — fully server-rendered)
- **Database**: PostgreSQL via Sequelize ORM
- **Auth**: Passport.js (local strategy), bcryptjs, express-session, connect-flash
- **Email**: Resend API (`resend` npm package) — verification emails on signup
- **Image storage**: Cloudinary (uploads), Unsplash API (auto-fills placeholder car images hourly)
- **Car data**: NHTSA API for US makes/models + static international makes list in `config/carquery.js`
- **CSS framework**: Bootstrap 4 + custom styles in `public/css/style.css`

## Production
- **Server**: Hetzner VPS running Ubuntu, managed with PM2 (`pm2 restart autodex`)
- **Domain**: autodx.io with SSL via Certbot/Let's Encrypt
- **Reverse proxy**: nginx
- **Deploy flow**:
  ```bash
  # On the server (SSH in first):
  cd /var/www/autodex && git pull && NODE_ENV=production npx sequelize-cli db:migrate && pm2 restart autodex
  ```
- **DB**: PostgreSQL, user `autodex_user`, database `autodex`
- **Env vars on server**: stored in `/var/www/autodex/.env`

## Local Dev
- Run: `nodemon server.js`
- DB: local PostgreSQL
- Migrations: `npx sequelize-cli db:migrate`
- `.env` needs: `SECRET_SESSION`, `UKEY` (Unsplash), `USKEY`, `CKEY`, `CLOUDINARY_*`, `RESEND_API_KEY`, `BASE_URL`, `EMAIL_FROM`
- **Important**: `server.js` reads `process.env.SECRET_SESSION` (not `SESSION_SECRET`)

## Key Architecture Decisions

### Car Data
- US makes come from NHTSA API at startup
- International makes (BMW, Ferrari, Bugatti, etc.) are in a static list in `config/carquery.js` → `MAKES_LIST`
- `getMakes()` returns the static list; `getModels(make)` hits NHTSA with 6hr in-memory cache
- `seedAllMakes()` in `server.js` runs 5s after startup to seed missing makes into DB (600ms delay between makes)
- Unsplash image updater runs every hour, 50 cars per run, priority makes first (BMW, Porsche, Ferrari, etc.)
- `updated_img` boolean on `cars` table — `true` means image came from Unsplash or admin approval (not placeholder)

### Users & Auth
- Email verification required on signup via Resend API
- `emailVerified` and `verificationToken` fields on `users` table
- Admin can manually verify users at `/garage/admin`
- `isAdmin` boolean on `users` table; admin middleware in `middleware/isAdmin.js`
- `lastLoginAt` tracked on every successful login

### Garage
- `user_cars` table: cars users add to their own garage (custom make/model/year/image/notes)
- `favorite_cars` table: cars from the main catalog that users favorite
- Both shown on `/garage` — My Cars (badge: blue) and Favorites (badge: orange)
- Duplicate favorites prevented via `findOrCreate` on `{ carId, userId }`

### Image Proposals
- `image_proposals` table: users propose images for placeholder cars
- Status: `pending` → `approved` or `rejected`
- Approve applies image to `cars` table and sets `updated_img: true`
- "Propose Image" button shown on detail page when `!carUpdatedImg` and user is logged in

### Frontend Interactions
- Favorites: fully AJAX — add/remove updates DOM without page reload
- `pageshow` event handles bfcache back-button blank page fix
- Mobile: scroll-based dot wave animation (replaces cursor tracking on touch devices)
- Named functions `bindDetailFavForm()` / `bindDetailRemoveForm()` in `public/js/main.js` for rebinding after DOM swaps

## File Map
```
server.js                    — app entry, routes, Unsplash updater, seedAllMakes
controllers/
  auth.js                    — signup, login, logout, email verify, resend verify
  cars.js                    — browse, search, detail, favorites (AJAX), propose image
  garage.js                  — garage CRUD, admin panel, proposal approve/reject
config/
  carquery.js                — static MAKES_LIST + NHTSA getModels() with cache
  cloudinary.js              — Cloudinary + multer setup
  email.js                   — Resend API sendVerificationEmail()
  ppConfig.js                — Passport local strategy
middleware/
  isAdmin.js                 — blocks non-admin users
  isLoggedIn.js              — blocks unauthenticated users
models/
  user.js                    — name, email, password (hashed), isAdmin, emailVerified, verificationToken, lastLoginAt
  car.js                     — make, model, image, favcount, updated_img
  user_car.js                — userId, make, model, year, image, notes
  favorite_car.js            — userId, carId (+ denormalized make/model/image)
  image_proposal.js          — carId, userId, imageUrl, status (pending/approved/rejected)
views/
  layout.ejs                 — main layout (nav, flash alerts)
  index.ejs                  — homepage
  makes.ejs                  — Browse Manufacturers grid
  garage/index.ejs           — My Garage (My Cars + Favorites tabs)
  garage/admin.ejs           — Admin: placeholder cars, proposals, unverified users, all users
  garage/add-car.ejs         — Add car to garage form
  cars/detail.ejs            — Car detail page (favorite, propose image)
  cars/search.ejs            — Search results
  auth/login.ejs             — Login + resend verification form
  auth/signup.ejs            — Signup
  partials/car-grid.ejs      — Reusable car card grid
public/
  css/style.css              — Custom styles (card badges, dot grid, animations)
  js/main.js                 — Client JS (AJAX favorites, scroll wave, bfcache fix)
migrations/                  — All Sequelize migrations (run in order)
```

## Admin Panel (`/garage/admin`)
- Unverified users table with manual Verify button
- Pending image proposals grid with Approve/Reject
- All users table: name, email, joined, last login, favorites count, garage cars count, proposals count, verified status
- Placeholder cars grid with Update Image modal (URL or file upload)

## Gotchas
- CarQuery API blocks server-side requests (returns HTML) — use static list + NHTSA instead
- `method-override` required for PUT/DELETE from HTML forms (`?_method=PUT`)
- Cloudinary upload middleware (`upload.single('carImage')`) must be on routes that accept file uploads
- `db.user.toJSON()` strips the password field (overridden on the model)
- The `SECRET_SESSION` env var name must match exactly — not `SESSION_SECRET`
