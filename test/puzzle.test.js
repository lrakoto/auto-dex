const assert = require('node:assert/strict');
const request = require('supertest');
const ejs = require('ejs');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const puzzle = require('../lib/puzzle');
const { createVerifiedUser, extractCsrf, getCsrfToken } = require('./helpers');

function assertShareResult(html, score, rows) {
  const field = html.match(/<textarea\b[^>]*\bid="puzzle-share-text"[^>]*>([\s\S]*?)<\/textarea>/);
  if (!field) throw new Error('completed puzzle has no shareable text');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (!canonical) throw new Error('completed puzzle has no canonical URL');
  if (!/\/puzzle$/.test(canonical[1])) throw new Error('puzzle canonical includes unexpected details');
  const date = field[1].match(/^AutoDex Daily Puzzle (\d{4}-\d{2}-\d{2}) /);
  if (!date) throw new Error('share text has no board date');
  const expected = `AutoDex Daily Puzzle ${date[1]} ${score}/6\n\n${rows.join('\n')}\n\n${canonical[1]}`;
  // Exact equality prevents the answer, guessed models or their URLs from
  // appearing in the shared payload while leaving the on-page reveal intact.
  if (field[1] !== expected) throw new Error('unexpected share result: ' + field[1]);
  if (!/\breadonly\b/.test(field[0].split('>')[0])) throw new Error('share text must be usable for manual copying');
}

describe('Daily car puzzle', function() {
  describe('pure helpers', function() {
    let realGetFuelSpecs;
    const answer = { make: 'Toyota', model: 'Puzzle Answer', country: 'Japan', decade: 1990 };
    const compact = { type: 'Compact Cars', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline' };
    beforeEach(function() {
      realGetFuelSpecs = carinfo.getFuelSpecs;
      puzzle.clearPuzzleCache();
    });
    afterEach(function() { carinfo.getFuelSpecs = realGetFuelSpecs; });

    it('buckets a year into its decade', function() {
      if (puzzle.decadeOf(1995) !== 1990) throw new Error('1995');
      if (puzzle.decadeOf(2000) !== 2000) throw new Error('2000');
      if (puzzle.decadeOf(1989) !== 1980) throw new Error('1989');
    });

    it('scores an exact match on every tile', async function() {
      carinfo.getFuelSpecs = async () => compact;
      const r = await puzzle.compareGuess({ make: 'Toyota', model: 'Puzzle Guess', year_min: 1992 }, answer);
      if (r.makeState !== 'exact' || r.countryState !== 'exact' || r.decadeState !== 'exact') throw new Error(JSON.stringify(r));
      if (r.decadeDirection !== null) throw new Error('no arrow on an exact decade');
      if (r.bodyClassState !== 'exact' || r.driveState !== 'exact' || r.fuelState !== 'exact') throw new Error('vehicle tiles: ' + JSON.stringify(r));
    });

    it('scores a decade one off as close, with an arrow toward the answer', async function() {
      carinfo.getFuelSpecs = async () => null;
      const r = await puzzle.compareGuess({ make: 'Honda', year_min: 2001 }, answer); // decade 2000
      if (r.makeState !== 'wrong' || r.countryState !== 'exact') throw new Error('make/country: ' + JSON.stringify(r));
      if (r.decadeState !== 'close' || r.decadeDirection !== 'lower') throw new Error('decade: ' + JSON.stringify(r));
    });

    it('scores a decade more than one off as wrong, still pointing the right way', async function() {
      carinfo.getFuelSpecs = async () => null;
      const r = await puzzle.compareGuess({ make: 'Ford', year_min: 1965 }, answer); // decade 1960
      if (r.countryState !== 'wrong') throw new Error('Ford is American, not Japanese');
      if (r.decadeState !== 'wrong' || r.decadeDirection !== 'higher') throw new Error('decade: ' + JSON.stringify(r));
    });

    it('scores body class, drive and fuel tiles as wrong on a mismatch', async function() {
      const truck = { type: 'Pickup Trucks', drive: 'Rear-Wheel Drive', fuel: 'Premium Gasoline' };
      carinfo.getFuelSpecs = async (make, model) => model === answer.model ? compact : truck;
      const r = await puzzle.compareGuess({ make: 'Ford', model: 'Puzzle Guess', year_min: 1992 }, answer);
      if (r.bodyClassState !== 'wrong' || r.driveState !== 'wrong' || r.fuelState !== 'wrong') throw new Error(JSON.stringify(r));
    });

    it('scores body class, drive and fuel tiles as unknown without FuelEconomy.gov data on either side', async function() {
      carinfo.getFuelSpecs = async () => null;
      const r = await puzzle.compareGuess({ make: 'Toyota', year_min: 1992 }, answer);
      if (r.bodyClassState !== 'unknown' || r.driveState !== 'unknown' || r.fuelState !== 'unknown') throw new Error(JSON.stringify(r));
    });

    it('scores the core guess without waiting for slow fuel data and reuses late data', async function() {
      let release, timer, calls = 0;
      const pending = new Promise(resolve => { release = resolve; });
      carinfo.getFuelSpecs = () => { calls++; return pending; };
      const guess = { make: 'Honda', model: 'Puzzle Guess', year_min: 1992 };
      try {
        const timedOut = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('the guess waited for the upstream lookup')), 1000);
        });
        const results = await Promise.race([
          Promise.all([puzzle.compareGuess(guess, answer), puzzle.compareGuess(guess, answer)]),
          timedOut
        ]);
        if (calls !== 2) throw new Error('parallel requests duplicated work');
        for (const result of results) {
          if (result.makeState !== 'wrong' || result.countryState !== 'exact' || result.decadeState !== 'exact') {
            throw new Error('slow data changed the core score');
          }
          if (result.bodyClassState !== 'unknown' || result.driveState !== 'unknown' || result.fuelState !== 'unknown') {
            throw new Error('slow data did not fall back to unknown');
          }
        }
        release(compact);
        const next = await puzzle.compareGuess(guess, answer);
        if (next.bodyClassState !== 'exact' || calls !== 2) throw new Error('late data was not reused');
      } finally {
        clearTimeout(timer);
        release(compact);
      }
    });

    it('renders a retained pre-tiles guess with three unknown cells', async function() {
      const html = await ejs.renderFile(require.resolve('../views/puzzle.ejs'), {
        answer, guesses: [{
          make: 'Honda', model: 'Puzzle Guess', country: 'Japan', decade: 1990,
          makeState: 'wrong', countryState: 'exact', decadeState: 'exact', correct: false
        }],
        done: false, puzzleDay: '2026-05-01', shareText: null, error: null,
        csrfToken: 'test', guessesLeft: 5, maxGuesses: 6
      });
      if (!html.includes('Honda Puzzle Guess') || !html.includes('5 guesses left')) throw new Error('legacy guess was lost');
      if ((html.match(/puzzle-tile--unknown">Unknown<\/span><\/td>/g) || []).length !== 3) {
        throw new Error('legacy cells did not use the unknown state');
      }
    });
  });

  describe('the day\'s car', function() {
    let realGetModels, realGetFuelSpecs;
    before(async function() {
      realGetModels = carquery.getModels;
      carquery.getModels = async () => []; // every candidate counts as listed
      realGetFuelSpecs = carinfo.getFuelSpecs;
      // Stands alone from the "playing" fixtures below: this file may run on
      // its own, before any other test file has dated a car.
      await db.car.create({ make: 'Mazda', model: 'Puzzle Dated Fixture', favcount: 0, updated_img: false, year_min: 2001, year_max: 2005 });
    });
    after(function() {
      carquery.getModels = realGetModels;
      carinfo.getFuelSpecs = realGetFuelSpecs;
    });

    it('picks an eligible, dated car and keeps it for the rest of the day', async function() {
      puzzle.clearPuzzleCache();
      const now = new Date('2026-05-01T12:00:00Z');
      let release, timer, warmed = 0;
      const pending = new Promise(resolve => { release = resolve; });
      carinfo.getFuelSpecs = () => { warmed++; return pending; };
      try {
        const timedOut = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('the day\'s car waited for fuel data')), 1500);
        });
        const first = await Promise.race([puzzle.getPuzzleCar(now), timedOut]);
        if (!first) throw new Error('no puzzle car — add a dated car fixture');
        if (!first.make || !first.country || typeof first.decade !== 'number') throw new Error('bad shape: ' + JSON.stringify(first));
        const second = await puzzle.getPuzzleCar(new Date('2026-05-01T23:00:00Z'));
        if (second.id !== first.id || warmed !== 1) throw new Error('same day did not reuse the car and its lookup');
      } finally {
        clearTimeout(timer);
        release(null);
      }
    });
  });

  describe('playing', function() {
    let realGetModels, realGetPuzzleCar, realGetFuelSpecs, answerRow;

    // The answer's tiles: Compact Cars / FWD / Regular Gasoline. "Puzzle
    // Future" shares them (so a guess scores class/drive/fuel independently
    // of make); "Puzzle Twin" has different ones (wrong); "Puzzle Vintage"
    // has none (unknown).
    const FUEL_SPECS = {
      'Puzzle Mystery': { type: 'Compact Cars', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline' },
      'Puzzle Future': { type: 'Compact Cars', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline' },
      'Puzzle Twin': { type: 'Pickup Trucks', drive: 'Rear-Wheel Drive', fuel: 'Premium Gasoline' },
      'Puzzle Vintage': null
    };

    before(async function() {
      realGetModels = carquery.getModels;
      carquery.getModels = async () => [];
      realGetFuelSpecs = carinfo.getFuelSpecs;
      carinfo.getFuelSpecs = async (make, model) => FUEL_SPECS[model] || null;

      const rows = await db.car.bulkCreate([
        { make: 'Toyota', model: 'Puzzle Mystery', favcount: 0, updated_img: false, year_min: 1995, year_max: 1998, model_years: [1995, 1996, 1997, 1998] },
        { make: 'Toyota', model: 'Puzzle Twin', favcount: 0, updated_img: false, year_min: 1992, year_max: 1994, model_years: [1992, 1993, 1994] },
        { make: 'Honda', model: 'Puzzle Future', favcount: 0, updated_img: false, year_min: 2015, year_max: 2020, model_years: [2015, 2016, 2017, 2018, 2019, 2020] },
        { make: 'Honda', model: 'Puzzle Recent', favcount: 0, updated_img: false, year_min: 2001, year_max: 2001, model_years: [2001] },
        { make: 'Ford', model: 'Puzzle Vintage', favcount: 0, updated_img: false, year_min: 1965, year_max: 1968, model_years: [1965, 1966, 1967, 1968] }
      ], { returning: true });
      answerRow = rows.find(r => r.model === 'Puzzle Mystery');

      puzzle.clearPuzzleCache();
      realGetPuzzleCar = puzzle.getPuzzleCar;
      puzzle.getPuzzleCar = async () => ({
        id: answerRow.id, make: answerRow.make, model: answerRow.model,
        country: 'Japan', decade: 1990, yearMax: answerRow.year_max
      });
    });
    after(function() {
      carquery.getModels = realGetModels;
      puzzle.getPuzzleCar = realGetPuzzleCar;
      carinfo.getFuelSpecs = realGetFuelSpecs;
    });

    it('shows a guess field and the guesses-left count', async function() {
      const agent = request.agent(app);
      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes('name="guess"')) throw new Error('no guess field');
      if (!res.text.includes('6 guesses left')) throw new Error('guess count: ' + res.text.match(/\d+ guesses? left/));
      if (res.text.includes('id="puzzle-share-text"')) throw new Error('unplayed puzzle has a share result');
      if (!/data-puzzle-streak data-day="\d{4}-\d{2}-\d{2}" data-result="pending"/.test(res.text)) {
        throw new Error('unplayed puzzle missing pending streak context');
      }
    });

    it('scores a wrong guess and keeps the board for the next one', async function() {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/puzzle');
      await agent.post('/puzzle/guess').type('form').send({ guess: 'Honda Puzzle Future', _csrf: token }).expect(302);

      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes('Puzzle Future')) throw new Error('guess not shown');
      if (!res.text.includes('puzzle-tile--wrong">Honda<')) throw new Error('make should read wrong');
      if (!res.text.includes('puzzle-tile--exact">Japan<')) throw new Error('country should read exact (Honda is Japanese too)');
      if (!res.text.includes('5 guesses left')) throw new Error('did not spend a guess');
      if (res.text.includes('id="puzzle-share-text"')) throw new Error('unfinished puzzle has a share result');
    });

    it('skips stale form guesses and shows the UTC rollover notice only once', async function() {
      const agent = request.agent(app);
      const page = await agent.get('/puzzle').expect(200);
      const formDay = page.text.match(/<input type="hidden" name="day" value="(\d{4}-\d{2}-\d{2})">/);
      assert.ok(formDay, 'guess form is missing its UTC puzzle day');
      const yesterday = new Date(Date.parse(`${formDay[1]}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const token = extractCsrf(page.text);
      const submit = (day, guess) => agent.post('/puzzle/guess').type('form').send({ day, guess, _csrf: token })
        .expect(302).expect('Location', '/puzzle');
      const notice = 'A new daily puzzle is up. Your guess was not used.';

      // A known car would otherwise spend a guess on the current board.
      await submit(yesterday, 'Toyota Puzzle Mystery');
      const fresh = await agent.get('/puzzle').expect(200);
      assert.ok(fresh.text.includes(notice));
      assert.match(fresh.text, /6 guesses left/);
      assert.doesNotMatch(fresh.text, /Got it in|class="puzzle-guess-name"/);

      const reload = await agent.get('/puzzle').expect(200);
      assert.ok(!reload.text.includes(notice));
      assert.match(reload.text, /6 guesses left/);

      await submit(formDay[1], 'Honda Puzzle Future');
      await submit(yesterday, 'Toyota Puzzle Twin');
      const ongoing = await agent.get('/puzzle').expect(200);
      assert.ok(ongoing.text.includes(notice));
      assert.match(ongoing.text, /5 guesses left/);
      assert.match(ongoing.text, /class="puzzle-guess-name">Honda Puzzle Future<\/td>/);
      assert.doesNotMatch(ongoing.text, /class="puzzle-guess-name">Toyota Puzzle Twin<\/td>/);
    });

    it('scores class, drive and fuel tiles on their own data, independent of make', async function() {
      // Puzzle Future shares the answer's body class, drive and fuel even
      // though its make (Honda) and decade are both wrong.
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/puzzle');
      await agent.post('/puzzle/guess').type('form').send({ guess: 'Honda Puzzle Future', _csrf: token }).expect(302);

      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes('puzzle-tile--exact">Compact Cars<')) throw new Error('class should read exact');
      if (!res.text.includes('puzzle-tile--exact">Front-Wheel Drive<')) throw new Error('drive should read exact');
      if (!res.text.includes('puzzle-tile--exact">Regular Gasoline<')) throw new Error('fuel should read exact');
    });

    it('scores class, drive and fuel tiles as wrong when FuelEconomy.gov data differs', async function() {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/puzzle');
      await agent.post('/puzzle/guess').type('form').send({ guess: 'Toyota Puzzle Twin', _csrf: token }).expect(302);

      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes('puzzle-tile--wrong">Pickup Trucks<')) throw new Error('class should read wrong');
      if (!res.text.includes('puzzle-tile--wrong">Rear-Wheel Drive<')) throw new Error('drive should read wrong');
      if (!res.text.includes('puzzle-tile--wrong">Premium Gasoline<')) throw new Error('fuel should read wrong');
    });

    it('shows an unknown tile when the guess has no FuelEconomy.gov data', async function() {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/puzzle');
      await agent.post('/puzzle/guess').type('form').send({ guess: 'Ford Puzzle Vintage', _csrf: token }).expect(302);

      const res = await agent.get('/puzzle').expect(200);
      const board = res.text.slice(res.text.indexOf('puzzle-board'), res.text.indexOf('</table>'));
      const unknownTiles = board.match(/puzzle-tile--unknown">Unknown</g) || [];
      if (unknownTiles.length !== 3) throw new Error('expected 3 unknown tiles (class, drive, fuel) on the board: ' + unknownTiles.length);
    });

    it('rejects a guess that is not in the catalog without spending one', async function() {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/puzzle');
      await agent.post('/puzzle/guess').type('form').send({ guess: 'Nothing Like This', _csrf: token }).expect(302);
      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes("isn&#39;t a car") && !res.text.includes("isn't a car")) throw new Error('no error shown');
      if (!res.text.includes('6 guesses left')) throw new Error('spent a guess on a bad name');
      if (res.text.includes('id="puzzle-share-text"')) throw new Error('invalid guess produced a share result');
    });

    it('shortens a long unknown guess before echoing it back', async function() {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/puzzle');
      await agent.post('/puzzle/guess').type('form').send({ guess: 'x'.repeat(500), _csrf: token }).expect(302);
      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes(`&#34;${'x'.repeat(79)}…&#34;`)) throw new Error('long guess not shortened');
      if (res.text.includes('x'.repeat(80))) throw new Error('long guess echoed in full');
    });

    it('wins on the exact car and reveals the answer', async function() {
      const agent = request.agent(app);
      const token = await getCsrfToken(agent, '/puzzle');
      await agent.post('/puzzle/guess').type('form').send({ guess: 'toyota   puzzle mystery', _csrf: token }).expect(302);

      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes('Got it in 1')) throw new Error('win message missing: ' + res.text.slice(0, 2000));
      if (!res.text.includes('/cars/car?make=Toyota&amp;model=Puzzle%20Mystery')) throw new Error('answer link missing');
      if (res.text.includes('name="guess"')) throw new Error('form should be gone once done');
      assertShareResult(res.text, 1, ['🟩🟩🟩🟩🟩🟩']);
      if (!/data-puzzle-streak data-day="\d{4}-\d{2}-\d{2}" data-result="won"/.test(res.text)) {
        throw new Error('finished win missing streak context');
      }
    });

    it('loses after six wrong guesses and still reveals the answer', async function() {
      const agent = request.agent(app);
      const guesses = ['Toyota Puzzle Twin', 'Honda Puzzle Future', 'Honda Puzzle Recent', ...Array(3).fill('Ford Puzzle Vintage')];
      for (const guess of guesses) {
        const token = await getCsrfToken(agent, '/puzzle');
        await agent.post('/puzzle/guess').type('form').send({ guess, _csrf: token }).expect(302);
      }
      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes('Out of guesses')) throw new Error('loss message missing');
      if (!res.text.includes('Puzzle Mystery')) throw new Error('answer not revealed');
      assertShareResult(res.text, 'X', [
        '🟩🟩🟩⬛⬛⬛', '⬛🟩⬛🟩🟩🟩', '⬛🟩🟨⬜⬜⬜', ...Array(3).fill('⬛⬛⬛⬜⬜⬜')
      ]);
      if (!/data-puzzle-streak data-day="\d{4}-\d{2}-\d{2}" data-result="lost"/.test(res.text)) {
        throw new Error('finished loss missing streak context');
      }
    });

    describe('account stats', function() {
      function guess(agent, token, guess) {
        return agent.post('/puzzle/guess').type('form').send({ guess, _csrf: token })
          .expect(302).expect('Location', '/puzzle');
      }

      it('combines past and current results and keeps the first result across sessions', async function() {
        const credentials = { email: 'puzzle-stats@example.com', password: 'password123' };
        const agent = request.agent(app);
        const { id: userId } = await createVerifiedUser(agent, db, credentials);
        const page = await agent.get('/puzzle').expect(200).expect('Cache-Control', 'private, no-store');
        const [, day] = page.text.match(/name="day" value="(\d{4}-\d{2}-\d{2})"/);
        assert.match(page.text, /id="puzzle-stats-empty"/);

        const puzzleDate = daysAgo => new Date(Date.parse(`${day}T00:00:00Z`) - daysAgo * 86400000).toISOString().slice(0, 10);
        await db.puzzle_result.bulkCreate([
          { userId, puzzleDate: puzzleDate(1), guessCount: null },
          { userId, puzzleDate: puzzleDate(2), guessCount: 6 }
        ]);
        await guess(agent, extractCsrf(page.text), 'Toyota Puzzle Mystery');

        const otherSession = request.agent(app);
        const loginToken = await getCsrfToken(otherSession);
        await otherSession.post('/auth/login').type('form').send({ ...credentials, _csrf: loginToken }).expect(302);
        const token = await getCsrfToken(otherSession, '/puzzle');
        await guess(otherSession, token, 'Toyota Puzzle Twin');
        await guess(otherSession, token, 'Toyota Puzzle Mystery');
        const result = await otherSession.get('/puzzle').expect(200);
        assert.match(result.text, /Got it in 2/);
        assert.match(result.text, /id="puzzle-games-played">3</);
        assert.match(result.text, /id="puzzle-win-rate">67%</);
        assert.deepEqual(Array.from(result.text.matchAll(/data-guess-count="\d">(\d+)</g), match => Number(match[1])), [1, 0, 0, 0, 0, 1]);
        assert.equal(await db.puzzle_result.count({ where: { userId } }), 3);
        const saved = await db.puzzle_result.findOne({ where: { userId, puzzleDate: day } });
        assert.equal(saved.guessCount, 1);
      });

      it('counts a finished loss without adding a win or exposing another account’s results', async function() {
        const agent = request.agent(app);
        const { id: userId } = await createVerifiedUser(agent, db, { email: 'puzzle-loss@example.com' });
        const token = await getCsrfToken(agent, '/puzzle');
        for (let i = 1; i < puzzle.MAX_GUESSES; i++) await guess(agent, token, 'Toyota Puzzle Twin');
        assert.equal(await db.puzzle_result.count({ where: { userId } }), 0);
        await guess(agent, token, 'Toyota Puzzle Twin');
        const page = await agent.get('/puzzle').expect(200);
        assert.match(page.text, /Out of guesses/);
        assert.match(page.text, /id="puzzle-games-played">1</);
        assert.match(page.text, /id="puzzle-win-rate">0%</);
        assert.deepEqual(Array.from(page.text.matchAll(/data-guess-count="\d">(\d+)</g), match => Number(match[1])), [0, 0, 0, 0, 0, 0]);
        const saved = await db.puzzle_result.findOne({ where: { userId } });
        assert.equal(saved.guessCount, null);
        const guest = await request(app).get('/puzzle').expect(200);
        assert.doesNotMatch(guest.text, /id="puzzle-account-stats"/);
      });

      it('keeps a guest board playable after login without importing its result', async function() {
        const agent = request.agent(app);
        const guestToken = await getCsrfToken(agent, '/puzzle');
        await guess(agent, guestToken, 'Toyota Puzzle Twin');
        const { id: userId } = await createVerifiedUser(agent, db, { email: 'puzzle-handoff@example.com' });
        const token = await getCsrfToken(agent, '/puzzle');
        await guess(agent, token, 'Toyota Puzzle Mystery');
        const page = await agent.get('/puzzle').expect(200);
        assert.match(page.text, /Got it in 2/);
        assert.match(page.text, /id="puzzle-games-played">0</);
        assert.equal(await db.puzzle_result.count({ where: { userId } }), 0);
      });

      it('keeps the completed board and retries a failed save after UTC rollover', async function() {
        const agent = request.agent(app);
        const { id: userId } = await createVerifiedUser(agent, db, { email: 'puzzle-retry@example.com' });
        const initial = await agent.get('/puzzle').expect(200);
        const token = extractCsrf(initial.text);
        const [, day] = initial.text.match(/name="day" value="(\d{4}-\d{2}-\d{2})"/);
        const tomorrow = Date.parse(`${day}T00:00:00Z`) + 86400000;
        const realDate = Date;
        const bulkCreate = db.puzzle_result.bulkCreate;
        db.puzzle_result.bulkCreate = async () => { throw new Error('fixture: save temporarily unavailable'); };
        try {
          await guess(agent, token, 'Toyota Puzzle Mystery');
          const pending = await agent.get('/puzzle').expect(200);
          assert.match(pending.text, /Got it in 1/);
          assert.match(pending.text, /id="puzzle-account-save-notice"/);
          assert.equal(await db.puzzle_result.count({ where: { userId } }), 0);

          global.Date = class extends realDate {
            constructor(...args) { super(...(args.length ? args : [tomorrow])); }
          };
          const nextBoard = await agent.get('/puzzle').expect(200);
          assert.match(nextBoard.text, /6 guesses left/);
          assert.match(nextBoard.text, /id="puzzle-account-save-notice"/);

          db.puzzle_result.bulkCreate = bulkCreate;
          const page = await agent.get('/puzzle').expect(200);
          assert.match(page.text, /id="puzzle-games-played">1</);
          assert.match(page.text, /id="puzzle-win-rate">100%</);
          assert.doesNotMatch(page.text, /id="puzzle-account-save-notice"/);
          const result = await db.puzzle_result.findOne({ where: { userId } });
          assert.equal(result.puzzleDate, day);
        } finally {
          global.Date = realDate;
          db.puzzle_result.bulkCreate = bulkCreate;
        }
        assert.equal(await db.puzzle_result.count({ where: { userId } }), 1);
      });
    });

    it('suggests catalog names for the guess field', async function() {
      const res = await request(app).get('/puzzle/suggest?q=Puzzle Tw').expect(200);
      if (!res.body.names.includes('Toyota Puzzle Twin')) throw new Error(JSON.stringify(res.body));
    });
  });
});
