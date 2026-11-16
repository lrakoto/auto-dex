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
- Unsplash was retired at the owner's request on October 15, 2026. Retired
  covers are hidden and queued for model-matched Commons replacement. Admin
  discovery also offers attributed Commons/Openverse candidates; approved
  alternatives join the gallery, where eligible photos can be voted on.
- The owner subsequently approved one exception: retain the original
  decorative Unsplash homepage hero, independently of Car of the Day.
- While the initial retirement queue remains, the hourly job checks up to
  500 vehicles per run, then returns to its normal 150. Requests stay
  sequential with the same spacing and failure stop; logs distinguish actual
  attempts from the selected batch when an outage stops a run early.
- Shipped matching is strict (make and whole model in the title; search
  results must name the model exactly). On the dev catalog it found photos
  for 19 of 30 random cars and 5 of 10 motorcycles.
- Exact article aliases cover Toyota GR86, MG3 and MG4 without loosening
  general matching. GR86 additionally requires its name in the lead photo's
  filename because the Toyota 86 article covers both generations. Missing
  covers for these names receive a one-time catch-up check, then normal retries.
  Descriptions and Wikidata facts use these same verified articles, avoiding
  unrelated bare-model results such as the MG3 machine gun.
- Two BMW series leads showed the wrong trim. The 528i uses a verified 2000
  E39 photo by Elise240SX, and the 750iL uses a verified E38 photo by TTTNIS.
  The old 550i and 730i files stay in gallery history with their votes but
  are excluded from display and selection for the two affected trims.
  [528i photo and license](https://commons.wikimedia.org/wiki/File:2000_BMW_528i_Sedan_in_Jet_Black,_Front_Left,_07-12-2023.jpg) ·
  [750iL photo and dedication](https://commons.wikimedia.org/wiki/File:BMW_750iL.jpg#Licensing).

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
- [x] A motorcycle round for Who's That Car? (the pool is cars only for now).
  Shipped at `/play?type=motorcycle`, with its own session streak; saved
  bests, the badge and the leaderboard stay cars-only.

### R4 — Daily car puzzle
- [x] One mystery car per day, the same for everyone: guess by name; each
  guess reveals tiles for make, country, era, body class, drivetrain and fuel
  (green exact, yellow close, arrows for higher/lower era). Shareable result
  grid, streak in `localStorage`, stats for signed-in players. Pattern:
  THROTTLE, Cardle.
  Shipped the core round at `/puzzle`: make, country and decade tiles (green
  exact, yellow a decade off, an arrow toward the answer's decade), six
  guesses, a session-held board that resets at UTC midnight. Body class,
  drivetrain and fuel tiles, the shareable grid, a `localStorage` streak and
  signed-in stats move to R16 below — this PR was already a full round of
  review on its own.

### R16 — Daily car puzzle: extras
- [x] Body class, drivetrain and fuel tiles on `/puzzle` (FuelEconomy.gov's
  `VClass`/`drive`/`fuelType1`, already fetched for the detail page by
  `lib/carinfo.js#getFuelSpecs`; cache the day's answer lookup the same way
  `lib/puzzle.js` caches the car itself).
  Shipped as three more tiles per guess, exact/wrong only (no "close"). The
  day's car warms its lookup without delaying the page, and guess scoring
  gives both cached lookups one short deadline. Missing or slow data reads
  as a faded "Unknown" tile without affecting the outcome of a guess.
- [x] A shareable result grid: completed boards offer a spoiler-free emoji
  summary with the UTC date, score, and puzzle link. Copy it with the button
  or select the text manually.
- [x] A browser-saved streak for consecutive daily puzzle wins. The streak
  uses the same UTC date as the puzzle, counts each day once, and resets
  after a loss or missed day.
- [x] Account stats (games played, win rate, guess distribution) for
  signed-in players. The account counts the first completed result per UTC
  day, starting with puzzles played entirely while signed in.

### R5 — Recall alerts for garage cars
- [x] Weekly job compares each garage car's NHTSA recalls with the last check
  and emails the owner about new ones (Resend is already set up). Opt-in
  setting on the garage page; unsubscribe link.
  Shipped as `jobs/recalls.js` (daily run, each car due weekly) with
  `users.recallAlerts` and a signed `/auth/recall-alerts/off` link.

### R6 — Running costs and a fuel log
- [x] Show FuelEconomy.gov's annual fuel cost, 5-year savings versus the
  average car, CO₂ g/mi and EPA scores on detail and compare pages (fields
  `fuelCost08`, `youSaveSpend`, `co2TailpipeGpm`, `feScore`, `ghgScore`).
  Shipped on the existing `carinfo.getFuelSpecs` lookup (`lib/carinfo.js`) —
  no new route, migration or env var.
- [x] Fuel log for garage cars: fill-ups, real MPG versus EPA, cost per mile.
  Shipped as `fuel_logs` (date, odometer, gallons, cost, notes) on the garage
  car page; real MPG is full-to-full across fill-ups, compared against
  `carinfo.getFuelSpecs`'s `combMpg` for the car's year.

### R7 — Dex rarity tiers and levels
- [x] Rarity per catalog car (common → legendary) from Wikidata production
  numbers (P1092, already fetched), model age and how often it is spotted.
  XP per spot scaled by rarity; levels on the garage and public pages.
  Data check (2026-10-29): Wikidata's P1092 (units built) is on 1 of 40
  random catalog cars, so it can't drive rarity yet; spot counts are the
  better signal once there are enough spots. Consider spot frequency plus
  model age first, P1092 only as an override where it exists.
  Shipped the tier itself as a badge on the car detail page (`lib/rarity.js`):
  common/uncommon/rare/legendary, scored live from global spot count (never
  spotted scores higher) and model age (older scores higher), with a very
  low P1092 figure jumping straight to legendary. XP per spot and levels on
  the garage and public pages move to R7b below — rarity needed to exist
  first, and this PR was already a full round of review on its own.

### R7b — XP and levels from rarity
- [x] Dex XP and levels on private and opted-in public garages. Each distinct
  model uses the XP from its earliest retained sighting. New sightings save
  10, 20, 35, or 50 XP according to model age and prior community sightings.
  Existing sightings count as 10 XP per model. Level 1 starts at 0 XP, and
  each additional 100 XP raises the level by one.

### R8 — Photo verification with Claude vision *(needs `ANTHROPIC_API_KEY`)*
- [ ] Before an automatically suggested photo or a user proposal becomes a hero, ask a
  vision model whether it shows the named make and model. Send 500 px
  images; at Claude Haiku 4.5 prices that is roughly $0.40 per thousand
  photos (half through the Batch API). Admin sees the verdicts; nothing is
  deleted automatically.

### R9 — Identify a spotted car from its photo *(needs `ANTHROPIC_API_KEY`)*
- [ ] On the Spotted it form, suggest the make and model from the uploaded
  photo, matched against the catalog. The user confirms.

### R10 — Cool Wall
- [x] Community tiers per car: Seriously Uncool, Uncool, Cool, Sub-Zero. One
  vote per user per car; aggregate placement shown on car pages and a wall
  page.
  Shipped as `cool_votes` (one tier per user per car) with a panel on car
  pages and `/cars/cool-wall`; a car's placement is the rounded mean of its
  votes (`lib/coolWall.js`).

### R11 — Size comparison
- [x] On the compare page, draw the cars' length, width and height to scale
  (Wikidata P2043, P2049, P2048).
  Shipped as side (length × height) and front (width × height) outlines on
  one millimetre scale (`lib/sizes.js`, `views/partials/size-compare.ejs`).
  On 40 random dev-catalog cars, 31 had a Wikipedia article and 11 had all
  three dimensions; multi-generation model-line entries (Civic, 911, MX-5)
  usually have none. Generation pages (R14) would raise that.

### R12 — Spot of the Day and an activity feed
- [x] Recent sightings from public garages at `/activity`. Show the model,
  public garage handle and UTC date for up to 12 sightings. The feed uses
  the same ordering and limit as the public garage, and changes to garage
  visibility or sighting deletion take effect on the next request.
- [x] Spot of the Day voting at `/activity` for photos from the public feed's
  recent sightings within the last seven UTC dates. Each signed-in account
  can choose one sighting per day, move or withdraw its vote, and see the
  current leader. The ballot resets at midnight UTC.
- [x] Recent photo quiz records from public garages at `/activity`. The feed
  shows the latest dated personal best per garage, up to 12 records. Scores
  earned before the date was recorded still appear on the leaderboard.
- [ ] Badge activity from public garages.

### R13 — Build log
- [x] Modifications on garage cars (part, vendor, cost, date, photos) beside
  the maintenance log, with a timeline on the car page and the public garage.
  Shipped as `build_entries` with a timeline on the garage car page and a
  Build Logs section on public garages (part, vendor, date and photo only;
  cost and notes stay private).

### R14 — Smaller ideas
- [x] "Find one for sale" search links (Autotrader, Cars.com, Bring a Trailer).
  Shipped with Autotrader (cars) and Bring a Trailer (cars and motorcycles),
  `lib/forSale.js`. Cars.com and eBay Motors sit behind bot walls that a
  scripted check can't pass; add them once someone confirms their search URL
  in a browser.
- [ ] Generation pages from Wikipedia/Wikidata generation articles.
  BMW detail pages now link to manufacturer records for the E39 528i and
  both the E32 and E38 750iL. The references use stored model years and
  show BMW's factory production dates explicitly.
  The 840Ci now has verified U.S. model years 1994–1997 and a separate E31
  factory production reference. Catalog upkeep corrects pre-launch years
  from vPIC and retains 1997 on later scans. [EPA 840Ci records](https://www.fueleconomy.gov/feg/Find.do?action=sbs&id=29073&id=11648&id=12565&id=13318) ·
  [BMW Classic E31 840Ci](https://www.bmwgroup-classic.com/de/modelle/bmw-klassiker/product-description-page.ad-211-1.bmw-840ci-e31.html).
  The 528i now shows the exact U.S. model-year runs of 1979–1981,
  1997–2000, and 2008–2016. The first two years predate AutoDex's vPIC scan.
  BMW Classic gives 1977–1981 as the E12 528i's factory production range.
  [1979 EPA guide](https://fueleconomy.gov/feg/epadata/79guide.txt) ·
  [1980 EPA guide](https://fueleconomy.gov/feg/epadata/80guide.txt) ·
  [1981 EPA guide](https://fueleconomy.gov/feg/epadata/81guide.txt) ·
  [EPA model-year dataset](https://fueleconomy.gov/feg/download.shtml) ·
  [BMW Classic E12 528i](https://www.bmwgroup-classic.com/en/models/bmw-classics/product-description-page.ad-159-1.bmw-528i-e12.html).
  The 528xi uses the EPA's 2008 model name and shows IFCAR's photo of the
  E60 sedan. Early BMW materials also used 528xi for 2009, which the EPA
  lists as 528i xDrive. The separate 528i xDrive entry covers two U.S.
  model-year runs, 2009–2010 and 2012–2016. Its cards and timeline preserve
  the 2011 gap from the EPA records.
  [EPA's 2008 528xi entry](https://www.fueleconomy.gov/feg/noframes/24031.shtml) ·
  [BMW's early price sheet for model year 2009](https://www.bimmerfile.com/wp-content/uploads/2008/09/2009-5-series-pricing1.pdf) ·
  [EPA's BMW 5 Series listings](https://www.fueleconomy.gov/Feg/bymodel/2009_BMW_5_Series.shtml) ·
  [IFCAR's public-domain photo](https://commons.wikimedia.org/wiki/File:BMW_528xi_sedan.jpg#Licensing) ·
  [EPA's 2010 xDrive record](https://www.fueleconomy.gov/feg/noframes/26384.shtml) ·
  [EPA's 2012 xDrive record](https://www.fueleconomy.gov/feg/noframes/32068.shtml) ·
  [EPA's 2016 xDrive record](https://www.fueleconomy.gov/feg/noframes/36680.shtml).
- [x] Generation photos for older trims: a series article leads with its
  current generation, so trims that ended years ago (BMW 633CSi, 840Ci) get no
  series photo. Generation articles ("BMW 5 Series (E34)") have the right car;
  pick one from the trim's `model_years`.
  Shipped in `lib/wikimedia.js` (`seriesGenerations`, `generationFor`): the
  series article's "(code)" links, each started in the first year its summary
  names; a model year counts toward the generation that started by the year
  before. Live: 528i (1997–2000) → E39, 633 CSi → E24, 750iL → E38, 840Ci →
  E31. Also fixed `VEHICLE_WORDS` rejecting articles that say "coupé".
- [x] Reclassify ATVs and side-by-sides as off-road. NHTSA lists many as
  motorcycles (Honda TRX/Rancher/Pioneer, Suzuki KingQuad/LT-, Kawasaki
  MULE/Brute Force, Yamaha Grizzly/YF-): 48 of 434 photographed
  "motorcycles" on the dev catalog. `isAtvName` in `lib/vehicleTypes.js`
  already spots them (the motorcycle quiz skips them); use it in
  `classifyModel` and update existing rows' `vehicle_type` (no deletes).
- [ ] More heavy-truck name patterns in `lib/vehicleTypes.js` as they turn
  up (Ford, GM, Ram, Isuzu and Mercedes-Benz are covered).
  2026-10-29: added "incomplete" and "medium duty", GM paired series
  (3500/4500, W3500/W4500, FTR / 6500XD), GM W-series and T-Series, and Ford
  E-450/E-550; `reclassifyCommercial` moves rows already typed as cars.
  Swept against all 5,201 dev-catalog rows: 16 new matches, all chassis or
  medium-duty trucks.
  2026-11-15: added nine Ford AeroMax and P-series codes and Mercedes-Benz
  LP1219, LP1419 and LPS1525. Manufacturer Cars tabs apply the same rules
  to their live NHTSA list. [Ford's NHTSA chassis listings](https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Ford/vehicletype/incomplete%20vehicle?format=json) ·
  [Mercedes-Benz trucks in NHTSA's 1986 records](https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Mercedes-Benz/modelyear/1986/vehicletype/Truck?format=json).
  2026-11-15: also matched the Ford F-590, original F-Super Duty, LL9000 and
  LLS9000 by exact name. [Ford's VIN coding submission](https://static.nhtsa.gov/nhtsa/downloads/MfrMail/01-22-N11B-4095.pdf).

### R17 — High-fidelity 3D cars *(requested by the owner)*

- [ ] Prototype an optional **View in 3D** on one car detail page. Show a
  poster first; load the viewer and model only when opened. Start with an
  exterior that visitors can rotate and zoom, with accurate proportions,
  wheels, lights, trim, and realistic paint and glass. Show the exact year,
  generation, and variant represented; a single mesh does not represent
  every car on a multi-generation catalog page.
- **2011 BMW 1 Series M Coupé.** Mike Pan modeled the E82 exterior from
  photos. It fits the exact [BMW 1M catalog entry](https://autodx.io/cars/car?make=BMW&model=1M),
  which lists 2011. Blender's archived demo page credits Pan and labels its
  `BMW27_2.blend.zip` benchmark CC0. Pan's separate BlendSwap upload lists
  CC BY-SA. The local inspection used `bmw27/bmw27_cpu.blend` from the Blender
  archive (ZIP SHA-256 `74f5dc6d718fc565e0ff50e355be7f8b1a58983cc9ae79775608d8905c269ee4`).
  After isolating one car and scaling to BMW's 2,660 mm wheelbase, the model
  measures 4,358 × 1,946 × 1,430 mm (length × overall width × height). The
  turned front tires set the model's width. BMW lists 4,380 mm long,
  1,932 mm across the mirrors, and 1,420 mm high.
  The first neutral GLB has 320,380 triangles and weighs 5,252,256 bytes.
  Its right-front rim faced inward. Reflecting that rim and its bolts across
  a plane through the hub, perpendicular to the axle, made all four rims
  face outward and preserved the repaired hub position.
  Halving the triangles in the tires, rims, and wheel bolts reduced the
  full export to 249,452 triangles (22% fewer) and 4,892,168 bytes (7% fewer).
  The other meshes retained identical geometry, and the overall dimensions
  shifted by less than 0.1 mm. Both versions rendered in a private Chrome
  orbit check. The simplified wheels retained the spoke layout and outline,
  with slightly coarser tread edges.
  The local painted export replaces the Cycles shading with glTF materials
  for clear-coated orange paint, transparent glazing, lamp housings and
  lenses, alloy wheels, and dark trim. The orange is an approximation of BMW's Valencia
  Orange Metallic. It uses no texture images and retains the same geometry
  and transforms. Materials and credits add 3,408 bytes for a total of
  4,895,576 bytes. Khronos's validator reported zero errors and warnings.
  A private Chrome fixture with AutoDex's CSP rendered one same-origin GLB
  at desktop and 390 px viewport widths. The second headlamp treatment made
  both circular optics easier to see head-on. Some off-angle glare remains,
  and the glazing shows the simplified cabin. Measure load time and orbit
  interaction on a real phone. Verify rights for the vehicle design, badges,
  and any retained textures before public delivery.
  [Blender's archived release](https://web.archive.org/web/20211226043144id_/https://www.blender.org/download/demo-files/) ·
  [Benchmark archive](https://download.blender.org/demo/test/BMW27_2.blend.zip) ·
  [Artist's portfolio](https://mikepan.com/bmw.html) ·
  [Artist's BlendSwap release](https://blendswap.com/blend/4066) ·
  [BMW's paint and wheel catalog](https://www.press.bmwgroup.com/south-africa/article/attachment/T0129290EN/195299) ·
  [BMW factory dimensions](https://www.press.bmwgroup.com/united-kingdom/article/attachment/T0110413EN_GB/159995).
- **1967 Ford Mustang Fastback.** Mark Peters publishes a 505,332-triangle
  exterior under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  The download listing says the interior and underside are absent. The
  artist's portfolio describes modeling an interior, so plan for an exterior
  viewer and confirm the contents when inspecting the source mesh. The live
  Mustang page currently shows 1981–2027. Confirm where the 1967 variant
  belongs before linking the viewer. The preview shows the fastback
  roof sweep, rear roof louvers, and a recessed tail panel with three individually
  framed lamps per side. These match Ford's 1967 Fastback 2+2 references.
  The model has GT-style grille fog lamps and a personalized plate. Ford's
  GT Equipment Group also included a GT or GTA side stripe, which isn't
  visible on the model. Use **1967 Ford Mustang Fastback 2+2 — artist's
  exterior model** as the working label, with trim, engine, and wheel
  specification unverified.
  Check the mesh against Ford's 108-inch wheelbase and overall dimensions
  of 183.6 × 70.9 × 51.8 inches (length × width × height) when the source
  files are available. Verify the texture credits and confirm Ford's
  clearance for public delivery of the downloadable browser asset.
  [Creator listing](https://sketchfab.com/3d-models/1967-ford-mustang-fastback-4096px2-02933292f4d64a52a9bec5923e24b0af) ·
  [Artist's portfolio](https://markpeters.art/ford-mustang-fastback-1967) ·
  [Ford's 1967 sales brochure](https://ponynsnake.com/wp-content/uploads/2023/07/access-1967_Ford_Mustang_brochure_AR_96_212010_18065.pdf) ·
  [Ford's 1967 launch release, pp. 2–3 and 10](https://www.1967shelbyresearch.com/library/docs/files/1966-09-16%20Ford%20Press%20Release%20-%201967%20Mustang.pdf#page=2) ·
  [Ford brand licensing](https://www.fordbrandlicensing.com/).
- **Volkswagen Golf reference scan.** The live
  [Volkswagen Golf catalog entry](https://autodx.io/cars/car?make=Volkswagen&model=Golf)
  includes 2004 in its year range. Spiicy lists a 2004 four-door Golf photoscan
  under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) at 78,660
  triangles. Its headlamps, grille, and side profile are consistent with the
  fourth-generation Golf in Volkswagen's archive photos. The scan's exact
  year, market, and trim remain unverified. The preview has gaps in the roof
  and windshield and includes the pavement. Use it as reference geometry
  for rebuilding surfaces and creating separate paint and glass materials.
  Check scale, remaining coverage, and rights for any retained branding or
  textures before public use.
  [Original listing](https://sketchfab.com/3d-models/photoscanned-volkswagen-golf-c1b1133cdf2944d3a72a8f8e37eb5429) ·
  [Volkswagen's archive photos](https://www.volkswagen-newsroom.com/en/images/albums/golf-4th-generation-1997-2003-2180) ·
  [Volkswagen model history](https://www.volkswagen-newsroom.com/en/golf-4-19972003-19476).
- **Chevrolet Caprice reference scan.** Marc Sawyer's 148,396-triangle cleanup
  credits jtressle's 737,051-triangle photogrammetry and LiDAR scan. Both
  listings use [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Sawyer labels the car a 1969 Caprice coupe. The roofline and tail lamps
  look consistent with Chevrolet's 1969 Custom Coupe. The previews show
  weathered paint, a distorted grille in the original scan, and opaque glass
  in the cleanup. The
  [Chevrolet Caprice catalog entry](https://autodx.io/cars/car?make=Chevrolet&model=Caprice)
  currently shows 1981–1996. Keep this as a reference until the year and
  variant are verified and the catalog can place them accurately.
  [Original scan](https://sketchfab.com/3d-models/old-chevy-caprice-c765fd12b7d841c9ae6f5ca245491e68) ·
  [Cleaned mesh](https://sketchfab.com/3d-models/chevrolet-caprice-coupe-1969-a7970c3b6b364a699504d415ad656372) ·
  [GM's 1969 model data](https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1969-Chevrolet.pdf).
- **Historical alternative.** Deutsches Museum publishes its reconstruction of
  Benz Patent-Motorwagen No. 1, inventory 4710, under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The model
  has 218,846 triangles and uses laser scans and photogrammetry of the museum
  specimen, which was reassembled in 1895. An optimized version would carry
  the museum credit and the same license. This fits a historical feature
  because there is no matching AutoDex catalog page.
  [Museum specimen history](https://www.deutsches-museum.de/museum/aktuell/eine-ikone-der-automobilgeschichte-wird-140) ·
  [Museum's 3D listing](https://sketchfab.com/3d-models/erster-dreirad-motorwagen-von-carl-benz-47df0cb894a34d33a09361f3cb182070).
- **Before publishing.** Record the exact source, license, asset revision,
  credits, changes, and any separate rights for marks and textures. Confirm
  permission covers optimizing and serving the files the browser receives.
  Obtain approval before any purchase or commission.
- [x] Prototype the viewer separately at `/dev/3d` with the CC0 Khronos Toy
  Car while sourcing the real car. The local lab loads self-hosted
  `<model-viewer>` and same-origin glTF only on request. The split textures
  avoid the need to relax CSP for embedded texture blob URLs. Start
  with a versioned mapping from the catalog entry to the exact variant,
  poster, model, and attribution. The first pilot needs no database
  migration or public upload flow.
- **Asset inspection.** Run `node scripts/inspect-car-gltf.js` with the local
  glTF or GLB file to record triangles, exported bounds, texture dimensions,
  and raw asset size. Compare the mesh and axle positions with references
  for the exact variant before testing it in the viewer. The trimmed Toy
  Car reports 91,331 triangles, 18.71 × 11.62 × 38.38 mm along glTF X/Y/Z,
  and five 1024 × 1024 PNG images in 4,126,731 asset bytes.
- **Catalog handoff.** The fictional AutoDex Lab / Khronos Toy Car fixture
  links its normal detail page to the pinned Toy Car lab. The shared local
  opt-in gates the link and viewer. The catalog page makes no 3D requests,
  and the lab starts with the poster. A verified real-car mapping is still
  needed for the pilot.
- **Sample size checkpoint.** Removing the fabric textures and repacking the
  geometry brought the Toy Car sample from 5.43 MB to 4.13 MB (24% smaller),
  excluding the viewer and poster. The car and glass geometry are unchanged.
  Textures are still served separately from the same origin under the existing
  CSP. At 390 pixels wide in desktop Chrome, the poster fit, the model
  loaded on demand, and dragging rotated the car. Retry recovered from a
  one-time geometry download failure. Zoom and Reset view buttons worked with
  mouse and keyboard at phone width in Chrome. Real-phone touch and load-time
  checks are still pending.
- **Toy Car network baseline (2026-11-14).** Local `/dev/3d` in desktop Chrome
  157 on an Apple M2, using a 390 × 844 CSS-pixel viewport at 2×, touch
  emulation, and disabled HTTP cache. Each trial started on a fresh page.
  The 26 KB poster was the only file fetched from the demo's asset directory
  before opening. Successful opens without Brotli fetched 5,082,287 bytes
  in response bodies, including 4,126,731 for the model and 955,556 for the viewer.
  Time runs from the click to the app's ready or timeout state. Chrome
  applied network throttling over loopback with desktop CPU and GPU performance.

  | Down / up | Added latency | Trials | Click to ready, median (range) |
  | --- | ---: | ---: | ---: |
  | Unthrottled | 0 ms | 3 | 0.32 s (0.17–1.48 s) |
  | 10 / 3 Mbps | 75 ms | 3 | 4.51 s (4.47–4.55 s) |
  | 3 / 1 Mbps | 150 ms | 3 | 14.26 s (14.24–14.27 s) |
  | 1.5 / 0.75 Mbps | 200 ms | 1 | Timed out at 20.00 s. Poster stayed visible. |

  With setup-time Brotli for the viewer, manifest, and geometry, complete
  opens transferred 2,903,423 bytes (43% fewer). The browser decoded the
  original bytes and still fetched only the poster from the asset directory
  before opening. Under the same throttled profiles, median click-to-ready
  time was 2.73 s at 10 Mbps, 8.43 s at 3 Mbps, and 16.36 s at 1.5 Mbps.
  All three trials at each speed reached ready.

- **BMW 1M network baseline (2026-11-15).** A private loopback fixture used
  the lab's poster-first controls and AutoDex CSP. Desktop Chrome 157 on
  Apple M2 used a 390 × 844 CSS-pixel viewport at 2×, touch emulation, and
  a fresh tab with HTTP cache disabled per trial. Only the poster was
  requested from the model asset directory before opening. The painted
  BMW GLB and pinned viewer transferred 5,851,132 response-body bytes
  uncompressed. Setup-time Brotli at quality 11 brought the total to
  2,231,708 bytes (62% fewer), including 2,022,986 for the model and 208,722
  for the viewer. Chrome decoded the original byte counts.

  | Down / up | Added latency | Trials per encoding | Identity click to ready | Brotli click to ready |
  | --- | ---: | ---: | ---: | ---: |
  | 10 / 3 Mbps | 75 ms | 3 | 4.98 s (4.96–4.99 s) | 2.08 s (2.07–2.08 s) |
  | 3 / 1 Mbps | 150 ms | 3 | 16.07 s (16.05–16.07 s) | 6.42 s (6.39–6.42 s) |
  | 1.5 / 0.75 Mbps | 200 ms | 1 | Timed out at 20.00 s | 12.45 s |

  Repeated trials show medians with the observed range in parentheses.
  The slow uncompressed trial kept the poster visible and offered Retry.
  Retry loaded the scene after removing the throttle.
  Emulated touch drag rotated the car, Zoom In narrowed the field of view,
  and Reset restored the initial orbit and zoom. A physical handset was
  unavailable. Verify loading, touch, and fallback on a real phone before
  setting the mobile performance budget.
- **Desktop WebKit check (2026-11-15).** An in-memory WKWebView on macOS
  26.6.2 opened the HTTP fixture but stalled before the poster or scripts
  loaded. Omitting `upgrade-insecure-requests` on the lab document let the
  same fixture render the painted BMW at 1000 × 700 and 390 × 844 CSS px.
  The poster loaded before opt-in. Both checks captured the WebGL scene from
  two angles and verified Zoom In, Reset, and return to the poster through the
  lab's button handlers. The orbit was moved through the viewer API. WebKit
  used uncompressed assets over this HTTP loopback. A physical-phone check
  of touch controls and timing remains open.
  [Helmet's explanation of Safari HTTP upgrades](https://helmet.js.org/).
- **Private preview command.** Run `scripts/preview-car-glb.js` with a local,
  self-contained GLB, a poster and the asset credit. The loopback viewer
  uses the current lab controls and approved viewer version, and starts
  independently of the catalog and database. The BMW model and poster
  stay in local files. See [the setup instructions](README.md#local-3d-viewer-prototype).
- **Gzip fallback (2026-11-15).** Desktop WKWebView received the painted
  BMW model and viewer over local HTTP using gzip. Their combined response
  bodies went from 5,851,132 to 3,360,599 bytes (43% smaller) and decoded to
  the original sizes. At both 1000 × 700 and 390 × 844 CSS px, the poster
  loaded before either asset and the model rendered after opt-in. Zoom,
  reset, and return to the poster passed. The Toy Car setup also produces
  gzip files. Brotli remains preferred at equal client weights.
- **Keyboard check (2026-11-15).** Desktop Chrome at 390 and 1000 CSS px
  loaded the BMW preview with Enter, reached the viewer with Tab, and
  orbited with the arrow keys. Zoom, Reset view, and closing with the
  keyboard worked. A simulated WebGL interruption restored the poster and
  moved focus to Retry from the viewer or camera controls. Focus on a link
  outside the viewer stayed there. Enter reopened the model after graphics
  recovered. [WebGL context-loss test extension](https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/).
- **Pilot checks.** Aim for 5 MB or less for the mobile model as an initial
  target. Check proportions against trusted references and measure load
  time and interaction on a real phone. Verify no 3D bytes load before
  opening, touch and keyboard controls work, and the photo remains usable
  if 3D fails. Add interiors, paint variants, or to-scale 3D comparisons
  only after the exterior pilot works; comparison needs verified dimensions
  for the exact generation.
- References: [Khronos glTF](https://www.khronos.org/gltf/),
  [model-viewer loading examples](https://modelviewer.dev/examples/loading/),
  and [Ford's TurboSquid approval process](https://www.turbosquid.com/help/en/articles/9937458-ford-license-restrictions).

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
