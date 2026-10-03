# AutoDex Roadmap

Work items in priority order, top to bottom (an item can sit above a
lower-numbered one). Each has a stable ID; pull requests for an item
put it in the title (`[R1] Integrate motorcycles`) so nobody starts it twice.
Check an item off in the same PR that finishes it. Research behind this list
(photo sources tested, car sites and apps surveyed): see "Sources" below.

## Ground rules (humans and automated runs)

- **`main` deploys to production.** Render builds and ships every push to
  `main` (autodx.io). Changes land through pull requests only.
- **Never delete catalog rows.** The `cars` table still holds ~1,050
  motorcycles, ATVs, buses and chassis from the old NHTSA seeding. They are
  being integrated as their own vehicle types (R1), not purged.
- Keep the `LOVA-NOTE` block at the top of `README.md` exactly as it is.
- Schema changes are new files in `migrations/` (never `sequelize.sync`).
  Tests build the schema from the migrations.
- Server-rendered EJS with a strict CSP: no inline `<script>`; page scripts
  live in `public/js/`. Every POST form carries `_csrf`. A POST form shown to
  signed-out visitors needs its path in `ANON_FORM_PATHS` (`server.js`).
- Call NHTSA model lookups as `carquery.getModels(...)` (module object) so
  tests can stub them. External lookups go through `lib/cache.js`.
- Wikimedia serves thumbnails at standard widths only (250, 330, 500, 960,
  1280, 1920, 3840 px); other widths return HTTP 400.
- New API keys are optional env vars: the feature turns itself off when the
  key is unset. Add them to `.env.example` and, as `sync: false`, to
  `render.yaml`, and say so in the PR.
- No paid services without the owner's go-ahead.
- `npm run lint` and `npm test` pass before a PR opens. Tests need Postgres
  with an `autodex_test` database (`createdb autodex_test`).

## Items

### R1 — Integrate motorcycles and other vehicles *(requested by the owner)*
- [x] Add a vehicle type per catalog row (car, SUV/minivan, pickup, motorcycle,
  off-road/ATV, commercial/bus, chassis). Source: NHTSA
  `GetModelsForMakeYear/make/{make}/vehicletype/{type}` lists, via
  `carquery.getModelsByType`. Classify existing rows in a migration-safe
  backfill job, not by deleting anything.
- Heuristics already measured on the dev DB: a model listed only under
  non-passenger types is non-passenger; an unlisted model in a make with 3×
  more non-passenger than passenger models (Honda, Suzuki) is almost always a
  motorcycle under an old name; unlisted models in car makes are usually
  renamed cars (Polestar "PS2") and stay cars.
- Browse, Explore and the makes page get type filters or sections; add
  motorcycle-only makes (Harley-Davidson, Ducati, Kawasaki, Triumph, KTM,
  Royal Enfield, Indian, Aprilia). The Dex counts every type; the quiz can
  offer a motorcycle round. `getModels` keeps its passenger-only default for
  car pages.

### R2 — Accurate photos from Wikipedia / Wikimedia Commons
- [x] Use the lead image of the car's Wikipedia article as the default hero
  (the summary endpoint `lib/carinfo.js` already calls returns it as
  `originalimage`). Record author and license from the Commons `imageinfo`
  API (`extmetadata`: Artist, LicenseShortName, LicenseUrl) and show them in
  the photo credit. Serve 1280 px heroes and 500 px cards.
- Measured on 60 random catalog cars: 40 had a lead image and 39 of those
  named the right car. Most misses were heavy trucks or naming mismatches
  ("EQB-Class" vs "Mercedes-Benz EQB"); better title matching raises coverage.
- Unsplash stays as the fallback. New photos join the gallery, so votes still
  pick the hero.
- Shipped matching is strict (make and whole model in the title; search
  results must name the model exactly). On the dev catalog it found photos
  for 19 of 30 random cars and 5 of 10 motorcycles.

### R3 — Safety and owner-reported problems on car pages
- [x] NHTSA 5-star ratings (`api.nhtsa.gov/SafetyRatings/...`: overall,
  frontal, side, rollover) on the detail and compare pages.
- [x] Owner complaints summary from `api.nhtsa.gov/complaints/complaintsByVehicle`:
  count per model year and the top components (the 2016 Civic has 1,080
  complaints, 444 about steering). Cached like the recalls lookup.

### R15 — Quick wins: placeholder, photo coverage, motorcycle quiz
Small, independent fixes, one checkbox per PR, in this order. Moved up from
R14 on 2026-10-01 so they ship before R4.
- [x] Replace the placeholder photo: it reads "Unsplash Image API Limit
  Reached", which is wrong for every car still waiting for a photo. Serve a
  neutral local image and repoint existing placeholder rows in a migration
  (rows only change their `image`; nothing is deleted).
- [x] Wikipedia photos for trim-level names: BMW "525i" or "750Li" live in
  series articles ("BMW 5 Series"). A small model → article map in
  `lib/wikimedia.js` would cover them. Shipped as `seriesOf` (BMW, Infiniti,
  Audi; 138 dev-catalog rows), used only for trims still on sale.
- [x] Re-check Wikipedia now and then for cars it had nothing for
  (`cars.wiki_checked` is a single pass; articles gain photos over time).
  Record when a car was checked and retry after a few weeks. Shipped as
  `cars.wiki_checked_at`; re-checks after 30 days, after never-checked cars.
- [ ] A motorcycle round for Who's That Car? (the pool is cars only for now).

### R4 — Daily car puzzle
- [ ] One mystery car per day, the same for everyone: guess by name; each
  guess reveals tiles for make, country, era, body class, drivetrain and fuel
  (green exact, yellow close, arrows for higher/lower era). Shareable result
  grid, streak in `localStorage`, stats for signed-in players. Pattern:
  THROTTLE, Cardle.

### R5 — Recall alerts for garage cars
- [ ] Weekly job compares each garage car's NHTSA recalls with the last check
  and emails the owner about new ones (Resend is already set up). Opt-in
  setting on the garage page; unsubscribe link.

### R6 — Running costs and a fuel log
- [ ] Show FuelEconomy.gov's annual fuel cost, 5-year savings versus the
  average car, CO₂ g/mi and EPA scores on detail and compare pages (fields
  `fuelCost08`, `youSaveSpend`, `co2TailpipeGpm`, `feScore`, `ghgScore`).
- [ ] Fuel log for garage cars: fill-ups, real MPG versus EPA, cost per mile.

### R7 — Dex rarity tiers and levels
- [ ] Rarity per catalog car (common → legendary) from Wikidata production
  numbers (P1092, already fetched), model age and how often it is spotted.
  XP per spot scaled by rarity; levels on the garage and public pages.

### R8 — Photo verification with Claude vision *(needs `ANTHROPIC_API_KEY`)*
- [ ] Before an Unsplash result or a user proposal becomes a hero, ask a
  vision model whether it shows the named make and model. Send 500 px
  images; at Claude Haiku 4.5 prices that is roughly $0.40 per thousand
  photos (half through the Batch API). Admin sees the verdicts; nothing is
  deleted automatically.

### R9 — Identify a spotted car from its photo *(needs `ANTHROPIC_API_KEY`)*
- [ ] On the Spotted it form, suggest the make and model from the uploaded
  photo, matched against the catalog. The user confirms.

### R10 — Cool Wall
- [ ] Community tiers per car: Seriously Uncool, Uncool, Cool, Sub-Zero. One
  vote per user per car; aggregate placement shown on car pages and a wall
  page.

### R11 — Size comparison
- [ ] On the compare page, draw the cars' length, width and height to scale
  (Wikidata P2043, P2049, P2048).

### R12 — Spot of the Day and an activity feed
- [ ] Community vote on recent spots with photos; a feed of spots, badges and
  quiz records from public garages only.

### R13 — Build log
- [ ] Modifications on garage cars (part, vendor, cost, date, photos) beside
  the maintenance log, with a timeline on the car page and the public garage.

### R14 — Smaller ideas
- [ ] "Find one for sale" search links (Autotrader, Cars.com, Bring a Trailer).
- [ ] Generation pages from Wikipedia/Wikidata generation articles.
- [ ] Generation photos for older trims: a series article leads with its
  current generation, so trims that ended years ago (BMW 633CSi, 840Ci) get no
  series photo. Generation articles ("BMW 5 Series (E34)") have the right car;
  pick one from the trim's `model_years`.
- [ ] More heavy-truck name patterns in `lib/vehicleTypes.js` as they turn
  up (Ford, GM, Ram, Isuzu and Mercedes-Benz are covered).

## Sources

- Car spotting apps: Carva (carvapp.com), CarSpotter, Spotter, AutoSpotterX,
  Carspot, Autogespot (Spot of the Day/Month/Year).
- Daily car puzzles: THROTTLE (throttle-game.com), Cardle (cardle.uk),
  CarSpotr, Vroomdle.
- Recognition: CarNet.ai (make/model/generation API).
- Ownership: CARFAX Car Care, Fuelly. Builds: Builds, GarageLog, CarBuilds.
- Size: carsized.com. Market: Hagerty Valuation Tools, Bring a Trailer,
  Cars & Bids. Media: Top Gear Cool Wall.
- Data: NHTSA vPIC, Safety Ratings, Complaints and Recalls APIs;
  FuelEconomy.gov; Wikipedia REST summary; Wikimedia Commons imageinfo;
  Wikimedia standard thumbnail sizes.
