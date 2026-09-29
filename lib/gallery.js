// Car image gallery + voting. cars.image remains the hero every page reads;
// refreshHero() re-points it at the top-scored gallery image.
const db = require('../models');

// Highest score wins. On a tie the current hero stays (then the oldest image
// wins), so the hero doesn't flicker and a hero set on purpose — an admin
// upload, the Wikipedia photo — isn't undone by a vote on another photo.
async function refreshHero(carId, { transaction } = {}) {
  const car = await db.car.findByPk(carId, { attributes: ['id', 'image'], transaction });
  if (!car) return null;
  const isHero = db.sequelize.literal(`"car_image"."url" = ${db.sequelize.escape(car.image || '')}`);
  const top = await db.car_image.findOne({
    where: { carId },
    order: [['score', 'DESC'], [isHero, 'DESC'], ['id', 'ASC']],
    transaction
  });
  if (!top) return null;
  await db.car.update({ image: top.url, updated_img: true }, { where: { id: carId }, transaction });
  return top;
}

// Add an image to a car's gallery (no-op if the URL is already there).
// makeHero forces it to be the hero right now (admin override / first image).
async function addImage(carId, url, {
  userId = null, source = 'user', makeHero = false, creditName = null, creditUrl = null, license = null, licenseUrl = null
} = {}) {
  const [image] = await db.car_image.findOrCreate({
    where: { carId, url },
    defaults: {
      userId, source, score: 0,
      credit_name: creditName, credit_url: creditUrl, credit_checked: !!creditName,
      license, license_url: licenseUrl
    }
  });
  if (makeHero) {
    await db.car.update({ image: url, updated_img: true }, { where: { id: carId } });
  } else {
    const car = await db.car.findByPk(carId, { attributes: ['id', 'updated_img'] });
    if (car && !car.updated_img) await refreshHero(carId);
  }
  return image;
}

// Record a user's vote (+1 / -1; 0 clears it), recompute the score from the
// votes table, and refresh the hero. Returns { score, myVote, heroUrl }.
async function vote(imageId, userId, value) {
  return db.sequelize.transaction(async (transaction) => {
    const image = await db.car_image.findByPk(imageId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!image) return null;
    if (value === 0) {
      await db.car_image_vote.destroy({ where: { imageId, userId }, transaction });
    } else {
      const [row, created] = await db.car_image_vote.findOrCreate({
        where: { imageId, userId }, defaults: { value }, transaction
      });
      if (!created && row.value !== value) await row.update({ value }, { transaction });
    }
    const score = (await db.car_image_vote.sum('value', { where: { imageId }, transaction })) || 0;
    await image.update({ score }, { transaction });
    const top = await refreshHero(image.carId, { transaction });
    return { score, myVote: value, heroUrl: top ? top.url : null };
  });
}

// Gallery for the detail page, with the viewer's own votes attached. Same
// order as refreshHero, so the hero leads its score group.
async function getGallery(carId, userId, heroUrl = null) {
  const isHero = db.sequelize.literal(`"car_image"."url" = ${db.sequelize.escape(heroUrl || '')}`);
  const images = await db.car_image.findAll({
    where: { carId },
    order: [['score', 'DESC'], [isHero, 'DESC'], ['id', 'ASC']],
    limit: 24
  });
  const mine = {};
  if (userId && images.length) {
    const votes = await db.car_image_vote.findAll({ where: { userId, imageId: images.map(i => i.id) } });
    votes.forEach(v => { mine[v.imageId] = v.value; });
  }
  return images.map(i => ({ ...i.toJSON(), myVote: mine[i.id] || 0 }));
}

module.exports = { addImage, vote, refreshHero, getGallery };
