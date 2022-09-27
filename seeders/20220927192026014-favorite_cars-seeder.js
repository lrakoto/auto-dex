'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('Favorite_cars', [
                {
                        id: "1",
                        make: "BMW",
                        model: "1M",
                        year: "",
                        image: "https://images.unsplash.com/photo-1600162207679-21e90aa4d118?crop=entropy&amp;cs=tinysrgb&amp;fit=max&amp;fm=jpg&amp;ixid=MnwzNjY4MDN8MHwxfHNlYXJjaHwxfHxCTVclMjAxTXxlbnwwfDB8fHwxNjY0MjUyMDUx&amp;ixlib=rb-1.2.1&amp;q=80&amp;w=400",
                        carId: "2944",
                        userId: "1",
                        createdAt: "Mon Sep 26 2022 21:37:23 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Mon Sep 26 2022 21:37:23 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "5",
                        make: "MASERATI",
                        model: "MC20",
                        year: "",
                        image: "https://www.topgear.com/sites/default/files/images/news-article/carousel/2020/09/6e7ec116688fe2918064495e831e060a/20200726_tg3998.jpg?w=1784&amp;h=1004",
                        carId: "18",
                        userId: "1",
                        createdAt: "Mon Sep 26 2022 22:11:00 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Mon Sep 26 2022 23:24:30 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "2",
                        make: "HONDA",
                        model: "Civic",
                        year: "",
                        image: "https://www.topgear.com/sites/default/files/images/news-article/carousel/2020/09/6e7ec116688fe2918064495e831e060a/20200726_tg3998.jpg?w=1784&amp;h=1004",
                        carId: "5047",
                        userId: "1",
                        createdAt: "Mon Sep 26 2022 21:55:16 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Mon Sep 26 2022 23:27:36 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "3",
                        make: "SUBARU",
                        model: "WRX",
                        year: "",
                        image: "https://www.topgear.com/sites/default/files/images/news-article/carousel/2020/09/6e7ec116688fe2918064495e831e060a/20200726_tg3998.jpg?w=1784&amp;h=1004",
                        carId: "2633",
                        userId: "1",
                        createdAt: "Mon Sep 26 2022 21:58:30 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Mon Sep 26 2022 23:33:06 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "6",
                        make: "LAMBORGHINI",
                        model: "Aventador",
                        year: "",
                        image: "https://i.ibb.co/PwkqdSy/placeholder.png",
                        carId: "1748",
                        userId: "1",
                        createdAt: "Mon Sep 26 2022 23:35:47 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Mon Sep 26 2022 23:35:47 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "7",
                        make: "BMW",
                        model: "M6",
                        year: "",
                        image: "https://images.unsplash.com/photo-1517153295259-74eb0b416cee?crop=entropy&amp;cs=tinysrgb&amp;fit=max&amp;fm=jpg&amp;ixid=MnwzNjY4MDN8MHwxfHNlYXJjaHwxfHxCTVclMjBNNnxlbnwwfDB8fHwxNjY0MjUyMDQ5&amp;ixlib=rb-1.2.1&amp;q=80&amp;w=400",
                        carId: "95",
                        userId: "1",
                        createdAt: "Mon Sep 26 2022 23:40:19 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Mon Sep 26 2022 23:40:19 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "8",
                        make: "MITSUBISHI",
                        model: "Lancer",
                        year: "",
                        image: "https://i.ibb.co/PwkqdSy/placeholder.png",
                        carId: "1666",
                        userId: "1",
                        createdAt: "Tue Sep 27 2022 00:03:13 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Tue Sep 27 2022 00:03:13 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "10",
                        make: "TOYOTA",
                        model: "SCION xA",
                        year: "",
                        image: "https://i.ibb.co/PwkqdSy/placeholder.png",
                        carId: "20",
                        userId: "1",
                        createdAt: "Tue Sep 27 2022 00:07:27 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Tue Sep 27 2022 00:07:27 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "11",
                        make: "MASERATI",
                        model: "Granturismo",
                        year: "",
                        image: "https://images.unsplash.com/photo-1589134723101-5abd32593adf?crop=entropy&amp;cs=tinysrgb&amp;fit=max&amp;fm=jpg&amp;ixid=MnwzNjY4MDN8MHwxfHNlYXJjaHwxfHxNQVNFUkFUSSUyMEdyYW50dXJpc21vfGVufDB8MHx8fDE2NjQyNDI1OTM&amp;ixlib=rb-1.2.1&amp;q=80&amp;w=400",
                        carId: "8",
                        userId: "1",
                        createdAt: "Tue Sep 27 2022 00:13:04 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Tue Sep 27 2022 00:13:04 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "9",
                        make: "TESLA",
                        model: "Model S",
                        year: "",
                        image: "https://media.autoexpress.co.uk/image/private/s--mXIuUVkh--/f_auto,t_content-image-full-desktop@1/v1611832929/autoexpress/2021/01/Tesla%20Model%20s%20facelift%202021-14.jpg",
                        carId: "1586",
                        userId: "1",
                        createdAt: "Tue Sep 27 2022 00:05:38 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Tue Sep 27 2022 00:15:33 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "4",
                        make: "MASERATI",
                        model: "Quattroporte",
                        year: "",
                        image: "https://cdn.motor1.com/images/mgl/BB08e/s1/2017-maserati-quattroporte.jpg",
                        carId: "7",
                        userId: "1",
                        createdAt: "Mon Sep 26 2022 22:08:05 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Tue Sep 27 2022 00:17:57 GMT-0700 (Pacific Daylight Time)",
                },
                {
                        id: "12",
                        make: "BMW",
                        model: "128i",
                        year: "",
                        image: "https://i.ibb.co/PwkqdSy/placeholder.png",
                        carId: "2892",
                        userId: "1",
                        createdAt: "Tue Sep 27 2022 07:43:39 GMT-0700 (Pacific Daylight Time)",
                        updatedAt: "Tue Sep 27 2022 07:43:39 GMT-0700 (Pacific Daylight Time)",
                },
            ]);
},

  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Favorite_cars', null, {});
  }
};