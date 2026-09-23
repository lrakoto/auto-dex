'use strict';

// 1. Photographer credit on gallery images (Unsplash API guidelines require
//    it). credit_checked marks rows the image job has tried to credit.
// 2. Existing Unsplash hotlinks were stored as urls.full (the original, often
//    4MB+). Re-point them at the same photo served at 1080px via imgix params.
//    Only catalog-sourced columns are touched, never user-supplied URLs.
//    cars.image / favorite_cars.image were VARCHAR(255) and the sized URLs
//    don't fit, so they become TEXT first.
// Runs in one transaction and tolerates a half-applied earlier attempt.

function sizedUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'images.unsplash.com') return url;
    u.searchParams.set('w', '1080');
    u.searchParams.set('fit', 'max');
    u.searchParams.set('q', '80');
    u.searchParams.set('auto', 'format');
    return u.toString();
  } catch (e) {
    return url;
  }
}

async function resize(queryInterface, transaction, table, column, extraWhere = '') {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT id, "${column}" AS url FROM ${table} WHERE "${column}" LIKE 'https://images.unsplash.com/%' ${extraWhere}`,
    { transaction }
  );
  for (const row of rows) {
    const next = sizedUrl(row.url);
    if (next === row.url) continue;
    await queryInterface.sequelize.query(
      `UPDATE ${table} SET "${column}" = :next WHERE id = :id`,
      { replacements: { next, id: row.id }, transaction }
    );
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const existing = await queryInterface.describeTable('car_images');
      const addColumn = (name, spec) => existing[name]
        ? Promise.resolve()
        : queryInterface.addColumn('car_images', name, spec, { transaction });
      await addColumn('credit_name', { type: Sequelize.TEXT, allowNull: true });
      await addColumn('credit_url', { type: Sequelize.TEXT, allowNull: true });
      await addColumn('credit_checked', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });

      await queryInterface.changeColumn('cars', 'image', { type: Sequelize.TEXT }, { transaction });
      await queryInterface.changeColumn('favorite_cars', 'image', { type: Sequelize.TEXT }, { transaction });

      // Gallery rows from the catalog/Unsplash job only (user proposals may
      // legitimately point wherever the user chose)
      await resize(queryInterface, transaction, 'car_images', 'url', `AND source IN ('catalog', 'unsplash')`);
      await resize(queryInterface, transaction, 'cars', 'image');
      await resize(queryInterface, transaction, 'favorite_cars', 'image');
    });
  },
  async down(queryInterface) {
    // URL resizing is not reversed (the sized URL is the same photo), and the
    // image columns stay TEXT — narrowing them back could truncate URLs.
    await queryInterface.removeColumn('car_images', 'credit_checked');
    await queryInterface.removeColumn('car_images', 'credit_url');
    await queryInterface.removeColumn('car_images', 'credit_name');
  }
};
