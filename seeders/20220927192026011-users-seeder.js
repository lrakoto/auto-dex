'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('Users', [
                {
                        id: "1",
                        name: "u",
                        email: "user@gmail.com",
                        password: "$2a$12$AH3o429ARSKWDU4quUTYjOOAUnIEXYyUe5VpEm36nbFb.30xWaMf6",
                        createdAt: "Mon Sep 26 2022 07:05:31 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Mon Sep 26 2022 07:05:31 GMT-0700 (Pacific Daylight Time)",
                },
            ]);
},

  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Users', null, {});
  }
};