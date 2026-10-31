// Dex rarity (R7): how uncommon a catalog car's model is to spot, worked out
// from how often it's actually been spotted and the model's age. Wikidata's
// P1092 (units built) covered only 1 of 40 random catalog cars in the
// 2026-10-29 data check, so it can't drive this on its own — it only ever
// pushes a car up a tier, when it exists, the way the compare page's
// dimension facts (R11) only show up where Wikidata has them.
const db = require('../models');
const carinfo = require('./carinfo');

// Index = the tier a car lands on
const TIERS = [
  { key: 'common', label: 'Common' },
  { key: 'uncommon', label: 'Uncommon' },
  { key: 'rare', label: 'Rare' },
  { key: 'legendary', label: 'Legendary' }
];

const LOW_PRODUCTION = 1000; // units built at/under this: legendary on its own
const LIMITED_PRODUCTION = 10000; // at/under this: a point toward rare

// Pure: whole years since `year` (a catalog row's year_max/year_min), as of `now`
function modelAge(year, now = new Date()) {
  return year ? Math.max(0, now.getFullYear() - year) : 0;
}

// Pure, exported for tests: spot frequency and model age score the tier; a
// low Wikidata production figure can only push the result up, never down.
function rarityTier({ year, spotCount = 0, unitsBuilt = null }, now = new Date()) {
  if (unitsBuilt != null && unitsBuilt <= LOW_PRODUCTION) return TIERS.length - 1;

  let points = 0;
  if (spotCount === 0) points += 2;
  else if (spotCount <= 2) points += 1;

  const age = modelAge(year, now);
  if (age >= 40) points += 2;
  else if (age >= 20) points += 1;

  if (unitsBuilt != null && unitsBuilt <= LIMITED_PRODUCTION) points += 1;

  if (points >= 4) return 3;
  if (points >= 3) return 2;
  if (points >= 1) return 1;
  return 0;
}

// The car detail page's badge. Spot count is global — every signed-in
// user's spottings of this catalog row, not just the viewer's. wikidataId
// comes from the same Wikipedia/Wikidata lookup the page already made for
// its facts panel, so this adds no extra request.
async function getCarRarity(car, wikidataId) {
  if (!car) return null;
  const [spotCount, unitsBuilt] = await Promise.all([
    db.spotting.count({ where: { carId: car.id } }),
    carinfo.getUnitsBuilt(wikidataId)
  ]);
  return rarityTier({ year: car.year_max || car.year_min || car.year, spotCount, unitsBuilt });
}

module.exports = { TIERS, modelAge, rarityTier, getCarRarity };
