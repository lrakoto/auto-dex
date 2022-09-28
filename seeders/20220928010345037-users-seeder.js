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
                {
                        id: "2",
                        name: "u2",
                        email: "user2@gmail.com",
                        password: "$2a$12$F17eYQd.HjH6kWbPqlo8WOimb7BFPvVVRiM66cYvhpSAVB.oY6ROi",
                        createdAt: "Tue Sep 27 2022 12:45:20 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Tue Sep 27 2022 12:45:20 GMT-0700 (Pacific Daylight Time)",
                },
            ]);
},

  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Users', null, {});
  }
};