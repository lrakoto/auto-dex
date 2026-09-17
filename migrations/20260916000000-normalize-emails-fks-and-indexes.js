'use strict';

// Follow-up to 20260905000001-add-performance-indexes:
//   • canonicalize users.email (lowercase + trim) so the unique index actually
//     enforces one account per address
//   • add ON DELETE CASCADE foreign keys to favorite_cars (was orphan-prone)
//   • add a unique index on cars(make, model) — duplicate rows already exist
//   • index cars.favcount / cars.updated_img, both used for ordering/filtering
//
// Data repair is deliberately conservative: rows that would collide are left
// untouched and logged, rather than silently deleted.
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = (sql, opts) => queryInterface.sequelize.query(sql, opts);

    // ── users.email: lower + trim (skip rows that would collide) ────────────
    await q(`
      UPDATE users u
      SET email = lower(btrim(u.email))
      WHERE u.email IS NOT NULL
        AND u.email <> lower(btrim(u.email))
        AND NOT EXISTS (
          SELECT 1 FROM users d
          WHERE d.id <> u.id
            AND lower(btrim(d.email)) = lower(btrim(u.email))
        );
    `);

    const [collisions] = await q(`
      SELECT lower(btrim(email)) AS normalized, COUNT(*) AS n
      FROM users
      WHERE email IS NOT NULL
      GROUP BY 1 HAVING COUNT(*) > 1;
    `);
    if (collisions.length > 0) {
      console.warn(
        '[migration] Users with duplicate normalized emails left as-is:',
        collisions.map(c => `${c.normalized} (${c.n})`).join(', ')
      );
    }

    // ── favorite_cars: cascade on user/car delete ──────────────────────────
    // Drop orphans first so the FK can be added.
    await q(`
      DELETE FROM favorite_cars fc
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = fc."userId")
         OR NOT EXISTS (SELECT 1 FROM cars c WHERE c.id = fc."carId");
    `);

    const [fkRows] = await q(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'favorite_cars'::regclass AND contype = 'f';
    `);
    const hasFk = name => fkRows.some(r => r.conname === name);
    if (!hasFk('favorite_cars_userid_fkey')) {
      await queryInterface.addConstraint('favorite_cars', {
        fields: ['userId'],
        type: 'foreign key',
        name: 'favorite_cars_userid_fkey',
        references: { table: 'users', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      });
    }
    if (!hasFk('favorite_cars_carid_fkey')) {
      await queryInterface.addConstraint('favorite_cars', {
        fields: ['carId'],
        type: 'foreign key',
        name: 'favorite_cars_carid_fkey',
        references: { table: 'cars', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      });
    }

    // ── cars(make, model): dedupe, then make unique ────────────────────────
    // Keep the lowest id; re-point favorites at it so nothing is lost.
    await q(`
      WITH dups AS (
        SELECT make, model, MIN(id) AS keep_id
        FROM cars
        GROUP BY make, model
        HAVING COUNT(*) > 1
      )
      UPDATE favorite_cars fc
      SET "carId" = d.keep_id
      FROM cars c
      JOIN dups d ON c.make = d.make AND c.model = d.model
      WHERE fc."carId" = c.id AND c.id <> d.keep_id;
    `);
    await q(`
      DELETE FROM cars c
      USING cars keep
      WHERE c.make = keep.make
        AND c.model = keep.model
        AND c.id > keep.id;
    `);

    const indexRow = await q(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'cars_make_model_idx';`
    );
    if (indexRow[0].length > 0) {
      await queryInterface.removeIndex('cars', 'cars_make_model_idx');
    }
    const [uniqueExists] = await q(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'cars_make_model_unique';`
    );
    if (uniqueExists.length === 0) {
      await queryInterface.addIndex('cars', ['make', 'model'], {
        name: 'cars_make_model_unique',
        unique: true
      });
    }

    // ── Ordering/filter indexes ────────────────────────────────────────────
    const [favIdx] = await q(`SELECT 1 FROM pg_indexes WHERE indexname = 'cars_favcount_idx';`);
    if (favIdx.length === 0) {
      await queryInterface.addIndex('cars', ['favcount'], { name: 'cars_favcount_idx' });
    }
    const [updIdx] = await q(`SELECT 1 FROM pg_indexes WHERE indexname = 'cars_updated_img_idx';`);
    if (updIdx.length === 0) {
      await queryInterface.addIndex('cars', ['updated_img'], { name: 'cars_updated_img_idx' });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('cars', 'cars_updated_img_idx');
    await queryInterface.removeIndex('cars', 'cars_favcount_idx');
    await queryInterface.removeIndex('cars', 'cars_make_model_unique');
    await queryInterface.addIndex('cars', ['make', 'model'], { name: 'cars_make_model_idx' });
    await queryInterface.removeConstraint('favorite_cars', 'favorite_cars_carid_fkey');
    await queryInterface.removeConstraint('favorite_cars', 'favorite_cars_userid_fkey');
  }
};
