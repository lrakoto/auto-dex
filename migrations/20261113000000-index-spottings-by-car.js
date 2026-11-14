'use strict';

const name = 'spottings_carid_idx';

module.exports = {
  async up(queryInterface) {
    // The existing userId-first index serves garage queries. The rarity
    // badge counts spots by car across users, including on public pages.
    await queryInterface.addIndex('spottings', ['carId'], { name, concurrently: true });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('spottings', name, { concurrently: true });
  }
};
