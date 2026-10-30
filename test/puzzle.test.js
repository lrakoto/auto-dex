const request = require('supertest');
const app = require('../server');
const db = require('../models');
const carquery = require('../config/carquery');
const carinfo = require('../lib/carinfo');
const puzzle = require('../lib/puzzle');
const { getCsrfToken } = require('./helpers');

describe('Daily car puzzle', function() {
  describe('pure helpers', function() {
    let realGetFuelSpecs;
    beforeEach(function() { realGetFuelSpecs = carinfo.getFuelSpecs; });
    afterEach(function() { carinfo.getFuelSpecs = realGetFuelSpecs; });

    it('buckets a year into its decade', function() {
      if (puzzle.decadeOf(1995) !== 1990) throw new Error('1995');
      if (puzzle.decadeOf(2000) !== 2000) throw new Error('2000');
      if (puzzle.decadeOf(1989) !== 1980) throw new Error('1989');
    });

    it('scores an exact match on every tile', async function() {
      carinfo.getFuelSpecs = async () => ({ type: 'Compact Cars', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline' });
      const answer = {
        make: 'Toyota', country: 'Japan', decade: 1990,
        bodyClass: 'Compact Cars', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline'
      };
      const r = await puzzle.compareGuess({ make: 'Toyota', year_min: 1992 }, answer);
      if (r.makeState !== 'exact' || r.countryState !== 'exact' || r.decadeState !== 'exact') throw new Error(JSON.stringify(r));
      if (r.decadeDirection !== null) throw new Error('no arrow on an exact decade');
      if (r.bodyClassState !== 'exact' || r.driveState !== 'exact' || r.fuelState !== 'exact') throw new Error('vehicle tiles: ' + JSON.stringify(r));
    });

    it('scores a decade one off as close, with an arrow toward the answer', async function() {
      carinfo.getFuelSpecs = async () => null;
      const answer = { make: 'Toyota', country: 'Japan', decade: 1990 };
      const r = await puzzle.compareGuess({ make: 'Honda', year_min: 2001 }, answer); // decade 2000
      if (r.makeState !== 'wrong' || r.countryState !== 'exact') throw new Error('make/country: ' + JSON.stringify(r));
      if (r.decadeState !== 'close' || r.decadeDirection !== 'lower') throw new Error('decade: ' + JSON.stringify(r));
    });

    it('scores a decade more than one off as wrong, still pointing the right way', async function() {
      carinfo.getFuelSpecs = async () => null;
      const answer = { make: 'Toyota', country: 'Japan', decade: 1990 };
      const r = await puzzle.compareGuess({ make: 'Ford', year_min: 1965 }, answer); // decade 1960
      if (r.countryState !== 'wrong') throw new Error('Ford is American, not Japanese');
      if (r.decadeState !== 'wrong' || r.decadeDirection !== 'higher') throw new Error('decade: ' + JSON.stringify(r));
    });

    it('scores body class, drive and fuel tiles as wrong on a mismatch', async function() {
      carinfo.getFuelSpecs = async () => ({ type: 'Pickup Trucks', drive: 'Rear-Wheel Drive', fuel: 'Premium Gasoline' });
      const answer = {
        make: 'Toyota', country: 'Japan', decade: 1990,
        bodyClass: 'Compact Cars', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline'
      };
      const r = await puzzle.compareGuess({ make: 'Ford', year_min: 1992 }, answer);
      if (r.bodyClassState !== 'wrong' || r.driveState !== 'wrong' || r.fuelState !== 'wrong') throw new Error(JSON.stringify(r));
    });

    it('scores body class, drive and fuel tiles as unknown without FuelEconomy.gov data on either side', async function() {
      carinfo.getFuelSpecs = async () => null;
      const answer = { make: 'Toyota', country: 'Japan', decade: 1990 };
      const r = await puzzle.compareGuess({ make: 'Toyota', year_min: 1992 }, answer);
      if (r.bodyClassState !== 'unknown' || r.driveState !== 'unknown' || r.fuelState !== 'unknown') throw new Error(JSON.stringify(r));
    });
  });

  describe('the day\'s car', function() {
    let realGetModels, realGetFuelSpecs;
    before(async function() {
      realGetModels = carquery.getModels;
      carquery.getModels = async () => []; // every candidate counts as listed
      realGetFuelSpecs = carinfo.getFuelSpecs;
      carinfo.getFuelSpecs = async () => ({ type: 'Compact Cars', drive: 'Front-Wheel Drive', fuel: 'Regular Gasoline' });
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
      const first = await puzzle.getPuzzleCar(now);
      if (!first) throw new Error('no puzzle car — add a dated car fixture');
      if (!first.make || !first.country || typeof first.decade !== 'number') throw new Error('bad shape: ' + JSON.stringify(first));
      if (first.bodyClass !== 'Compact Cars' || first.drive !== 'Front-Wheel Drive' || first.fuel !== 'Regular Gasoline') {
        throw new Error('vehicle tiles missing from the day\'s car: ' + JSON.stringify(first));
      }

      const second = await puzzle.getPuzzleCar(new Date('2026-05-01T23:00:00Z'));
      if (second.id !== first.id) throw new Error('same day picked a different car');
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
        { make: 'Ford', model: 'Puzzle Vintage', favcount: 0, updated_img: false, year_min: 1965, year_max: 1968, model_years: [1965, 1966, 1967, 1968] }
      ], { returning: true });
      answerRow = rows.find(r => r.model === 'Puzzle Mystery');

      const { type: bodyClass, drive, fuel } = FUEL_SPECS['Puzzle Mystery'];
      realGetPuzzleCar = puzzle.getPuzzleCar;
      puzzle.getPuzzleCar = async () => ({
        id: answerRow.id, make: answerRow.make, model: answerRow.model,
        country: 'Japan', decade: 1990, bodyClass, drive, fuel
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
    });

    it('loses after six wrong guesses and still reveals the answer', async function() {
      const agent = request.agent(app);
      for (let i = 0; i < 6; i++) {
        const token = await getCsrfToken(agent, '/puzzle');
        await agent.post('/puzzle/guess').type('form').send({ guess: 'Ford Puzzle Vintage', _csrf: token }).expect(302);
      }
      const res = await agent.get('/puzzle').expect(200);
      if (!res.text.includes('Out of guesses')) throw new Error('loss message missing');
      if (!res.text.includes('Puzzle Mystery')) throw new Error('answer not revealed');
    });

    it('suggests catalog names for the guess field', async function() {
      const res = await request(app).get('/puzzle/suggest?q=Puzzle Tw').expect(200);
      if (!res.body.names.includes('Toyota Puzzle Twin')) throw new Error(JSON.stringify(res.body));
    });
  });
});
