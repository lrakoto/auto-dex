const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const quiz = require('../lib/quiz');
const { getBadges } = require('../lib/dex');
const { getCarOfTheDay, clearDailyCache } = require('../lib/daily');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { PLACEHOLDER_URL } = require('../lib/constants');

const photo = slug => `https://example.com/quiz/${slug}.jpg`;

describe("Who's That Car?", function() {
  let realGetModels, cars;
  const byModel = model => cars.find(c => c.model === model);

  before(async function() {
    // Every catalog row counts as a listed passenger model (no NHTSA calls)
    realGetModels = carquery.getModels;
    carquery.getModels = async () => [];
    cars = await db.car.bulkCreate([
      { make: 'Pagani', model: 'Zonda', image: photo('zonda'), favcount: 0, updated_img: true },
      { make: 'Pagani', model: 'Zonda R', image: photo('zonda-r'), favcount: 0, updated_img: true },
      { make: 'Pagani', model: 'Huayra', image: photo('huayra'), favcount: 0, updated_img: true },
      { make: 'Pagani', model: 'Utopia', image: photo('utopia'), favcount: 0, updated_img: true },
      { make: 'Pagani', model: 'Imola', image: photo('imola'), favcount: 0, updated_img: true },
      { make: 'Pagani', model: 'No Photo Yet', image: PLACEHOLDER_URL, favcount: 0, updated_img: false },
      { make: 'Ferrari', model: 'F40', image: photo('f40'), favcount: 0, updated_img: true },
      { make: 'Lamborghini', model: 'Countach', image: photo('countach'), favcount: 0, updated_img: true },
      { make: 'Toyota', model: '2000GT', image: photo('2000gt'), favcount: 0, updated_img: true }
    ], { returning: true });
  });
  after(function() { carquery.getModels = realGetModels; });

  describe('rounds', function() {
    it('tightens the choices as the streak grows', function() {
      const counts = [0, 2, 3, 5, 6, 9, 40].map(quiz.sameMakeDecoys);
      if (counts.join() !== '0,0,1,1,2,3,3') throw new Error('same-make decoys: ' + counts.join());
    });

    it('never offers two names for the same car', function() {
      if (!quiz.confusable({ make: 'Honda', model: 'Civic' }, { make: 'Honda', model: 'Civic Type R' })) throw new Error('Civic / Civic Type R');
      if (quiz.confusable({ make: 'Porsche', model: '911' }, { make: 'Porsche', model: '918' })) throw new Error('911 / 918');
      if (quiz.confusable({ make: 'Honda', model: 'Civic' }, { make: 'Acura', model: 'Civic' })) throw new Error('different makes');
    });

    it('deals four photo cars, remembers the answer, and hides it from the view', async function() {
      const state = { streak: 0, recent: [] };
      const round = await quiz.newRound(state);
      if (!round || new Set(round.choices).size !== 4 || !round.choices.includes(round.answer)) {
        throw new Error('bad round: ' + JSON.stringify(round));
      }
      if (state.recent[state.recent.length - 1] !== round.answer) throw new Error('answer not remembered');
      const rows = await db.car.findAll({ where: { id: round.choices } });
      if (rows.some(r => r.image === PLACEHOLDER_URL)) throw new Error('a choice has no photo');

      const view = await quiz.roundView(round);
      if (Object.keys(view).sort().join() !== 'choices,credit,image') throw new Error('view leaks: ' + Object.keys(view));
      const answer = rows.find(r => r.id === round.answer);
      if (view.image !== answer.image) throw new Error('photo is not the answer');
      if (!view.choices.some(c => c.label === `${answer.make} ${answer.model}`)) throw new Error('labels wrong');
    });

    it('keeps dealing once every photo car has been seen lately', async function() {
      const all = await db.car.findAll({ attributes: ['id'] });
      const round = await quiz.newRound({ streak: 0, recent: all.map(c => c.id) });
      if (!round) throw new Error('quiz dead-ended in a small catalog');
    });

    it('at a streak of 9, every choice is the same make and none are confusable', async function() {
      // Only Pagani may be the answer
      const others = await db.car.findAll({ attributes: ['id'], where: { make: { [db.Sequelize.Op.ne]: 'Pagani' } } });
      const round = await quiz.newRound({ streak: 9, recent: others.map(c => c.id) });
      const rows = await db.car.findAll({ where: { id: round.choices } });
      if (!rows.every(r => r.make === 'Pagani')) throw new Error('mixed makes: ' + rows.map(r => r.make).join());
      for (const a of rows) {
        for (const b of rows) {
          if (a.id !== b.id && quiz.confusable(a, b)) throw new Error(`${a.model} with ${b.model}`);
        }
      }
    });
  });

  describe('playing', function() {
    let realNewRound, dealt, round, player, playerUser;

    before(async function() {
      realNewRound = quiz.newRound;
      dealt = 0;
      round = {
        answer: byModel('Zonda').id,
        choices: [byModel('Huayra').id, byModel('Zonda').id, byModel('F40').id, byModel('Countach').id]
      };
      quiz.newRound = async () => { dealt++; return { ...round, choices: [...round.choices] }; };
      player = request.agent(app);
      playerUser = await createVerifiedUser(player, db, { email: 'quizzer@example.com', name: 'Quizzer' });
    });
    after(function() { quiz.newRound = realNewRound; });

    const guess = (agent, choice, token, ajax = true) => {
      const req = agent.post('/play/guess').type('form').send({ choice, _csrf: token });
      return ajax ? req.set('X-Requested-With', 'XMLHttpRequest') : req;
    };

    it('shows the photo and four names, and a refresh keeps the same car', async function() {
      const res = await player.get('/play').expect(200);
      const values = [...res.text.matchAll(/name="choice" value="(\d+)"/g)].map(m => Number(m[1]));
      if (values.join() !== round.choices.join()) throw new Error('choices: ' + values.join());
      if (!res.text.includes(photo('zonda'))) throw new Error('photo missing');
      const before = dealt;
      await player.get('/play').expect(200);
      if (dealt !== before) throw new Error('refresh dealt a new car (skipping for free)');
    });

    it('scores a right answer, saves the best streak, and brings the next car', async function() {
      const token = await getCsrfToken(player, '/play');
      const res = await guess(player, round.answer, token).expect(200);
      const b = res.body;
      if (!b.correct || b.streak !== 1 || b.best !== 1) throw new Error('scoring: ' + JSON.stringify(b));
      if (b.make !== 'Pagani' || b.model !== 'Zonda' || b.url !== '/cars/car?make=Pagani&model=Zonda') throw new Error('reveal wrong');
      if (!b.next || b.next.choices.length !== 4 || 'answer' in b.next) throw new Error('next round wrong');
      await playerUser.reload();
      if (playerUser.quizBest !== 1) throw new Error('best not saved');
    });

    it('a miss ends the streak but never lowers the saved best', async function() {
      let token = await getCsrfToken(player, '/play');
      await guess(player, round.answer, token).expect(200); // streak 2
      token = await getCsrfToken(player, '/play');
      const res = await guess(player, byModel('F40').id, token).expect(200);
      if (res.body.correct || res.body.streak !== 0 || res.body.best !== 2) throw new Error('miss: ' + JSON.stringify(res.body));
      if (res.body.answerId !== round.answer || res.body.choice !== byModel('F40').id) throw new Error('reveal ids wrong');
      await playerUser.reload();
      if (playerUser.quizBest !== 2) throw new Error('best changed on a miss: ' + playerUser.quizBest);
    });

    it('turns away a guess from a stale tab', async function() {
      const token = await getCsrfToken(player, '/play');
      await guess(player, byModel('Utopia').id, token).expect(409);
    });

    it('works without JavaScript', async function() {
      const agent = request.agent(app);
      let token = await getCsrfToken(agent, '/play');
      await guess(agent, round.answer, token, false).expect(302).expect('Location', '/play');
      let page = await agent.get('/play').expect(200);
      if (!/class="play-last is-correct"/.test(page.text) || !page.text.includes('Pagani Zonda')) throw new Error('result banner missing');
      if (!/id="play-streak">1</.test(page.text)) throw new Error('streak not shown');
      page = await agent.get('/play').expect(200);
      if (page.text.includes('play-last')) throw new Error('result banner shown twice');

      token = await getCsrfToken(agent, '/play');
      await agent.post('/play/skip').type('form').send({ _csrf: token }).expect(302);
      page = await agent.get('/play').expect(200);
      if (!/id="play-streak">0</.test(page.text)) throw new Error('skip should end the streak');
    });

    it('awards Car Whisperer at 10 in a row', async function() {
      await db.user.update({ quizBest: 10 }, { where: { id: playerUser.id } });
      const badges = await getBadges(playerUser.id);
      if (!badges.find(b => b.id === 'car-whisperer').earned) throw new Error('badge not earned');
    });

    it('puts public garages, and only those, on the leaderboard', async function() {
      await db.user.update({ username: 'quiz_ace', garagePublic: true }, { where: { id: playerUser.id } });
      await db.user.create({ name: 'Private', email: 'private-ace@example.com', password: 'password123', quizBest: 99, username: 'hidden_ace' });
      const page = await request(app).get('/play').expect(200);
      if (!/@quiz_ace<\/a>\s*<span class="play-leader-score">10</.test(page.text)) throw new Error('public player missing');
      if (page.text.includes('hidden_ace')) throw new Error('private garage on the leaderboard');
    });
  });

  describe('motorcycle round', function() {
    let bikes, atv;
    const moto = attrs => ({ favcount: 0, updated_img: true, vehicle_type: 'motorcycle', ...attrs });

    before(async function() {
      bikes = await db.car.bulkCreate([
        moto({ make: 'Ducati', model: 'Monster', image: photo('monster') }),
        moto({ make: 'Ducati', model: 'Diavel', image: photo('diavel') }),
        moto({ make: 'Harley-Davidson', model: 'Fat Boy', image: photo('fat-boy') }),
        moto({ make: 'Kawasaki', model: 'Ninja ZX-6R', image: photo('zx6r') })
      ], { returning: true });
      // NHTSA lists ATVs like this one as motorcycles
      atv = await db.car.create(moto({ make: 'Honda', model: 'TRX450R', image: photo('trx') }));
      await db.car.create(moto({ make: 'Kawasaki', model: 'Vulcan No Photo', image: PLACEHOLDER_URL, updated_img: false }));
    });

    it('deals only motorcycles with photos, never ATVs', async function() {
      const bikeIds = bikes.map(b => b.id).sort().join();
      for (let i = 0; i < 6; i++) {
        const round = await quiz.newRound({ streak: 0, recent: [] }, 'motorcycle');
        if (!round || [...round.choices].sort().join() !== bikeIds) throw new Error('motorcycle round: ' + JSON.stringify(round));
        if (round.choices.includes(atv.id)) throw new Error('ATV dealt');
      }
    });

    it('keeps motorcycles out of the car round', async function() {
      const bikeIds = new Set([...bikes.map(b => b.id), atv.id]);
      for (let i = 0; i < 6; i++) {
        const round = await quiz.newRound({ streak: 0, recent: [] });
        if (round.choices.some(id => bikeIds.has(id))) throw new Error('motorcycle in a car round');
      }
    });

    it('has its own page and streak, and leaves the saved car best alone', async function() {
      const realNewRound = quiz.newRound;
      const motoRound = { answer: bikes[0].id, choices: bikes.map(b => b.id) };
      quiz.newRound = async (s, type) => (type === 'motorcycle' ? { ...motoRound, choices: [...motoRound.choices] } : realNewRound(s, type));
      try {
        const agent = request.agent(app);
        const user = await createVerifiedUser(agent, db, { email: 'biker@example.com', name: 'Biker' });
        const page = await agent.get('/play?type=motorcycle').expect(200);
        if (!page.text.includes("Who's That Motorcycle?")) throw new Error('heading');
        if (!page.text.includes('<input type="hidden" name="type" value="motorcycle">')) throw new Error('type not carried in the forms');
        if (!page.text.includes(photo('monster'))) throw new Error('photo missing');

        const token = await getCsrfToken(agent, '/play?type=motorcycle');
        const res = await agent.post('/play/guess').type('form').set('X-Requested-With', 'XMLHttpRequest')
          .send({ choice: bikes[0].id, type: 'motorcycle', _csrf: token }).expect(200);
        if (!res.body.correct || res.body.streak !== 1 || res.body.model !== 'Monster') throw new Error('scoring: ' + JSON.stringify(res.body));

        const carPage = await agent.get('/play').expect(200);
        if (!/id="play-streak">0</.test(carPage.text)) throw new Error('car streak picked up the motorcycle answer');
        await user.reload();
        if (user.quizBest !== 0) throw new Error('motorcycle streak saved as the car best');

        // Without JS, the answer comes back to the motorcycle round
        const token2 = await getCsrfToken(agent, '/play?type=motorcycle');
        await agent.post('/play/guess').type('form').send({ choice: bikes[0].id, type: 'motorcycle', _csrf: token2 })
          .expect(302).expect('Location', '/play?type=motorcycle');
      } finally {
        quiz.newRound = realNewRound;
      }
    });
  });

  describe('Car of the Day', function() {
    after(function() { clearDailyCache(); });

    it('picks one photo car per day, the same all day', async function() {
      clearDailyCache();
      const morning = await getCarOfTheDay(new Date('2026-09-28T01:00:00Z'));
      clearDailyCache();
      const night = await getCarOfTheDay(new Date('2026-09-28T23:00:00Z'));
      if (!morning || morning.image === PLACEHOLDER_URL) throw new Error('no photo car picked');
      if (morning.make !== night.make || morning.model !== night.model) throw new Error('pick changed within the day');
    });

    it('is featured on the homepage', async function() {
      clearDailyCache();
      const today = await getCarOfTheDay();
      const res = await request(app).get('/').expect(200);
      if (!res.text.includes('Car of the Day') || !res.text.includes(`<span class="cotd-model">${today.model}</span>`)) {
        throw new Error('car of the day missing');
      }
    });
  });
});
