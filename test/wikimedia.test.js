const path = require('path');
const ejs = require('ejs');
const db = require('../models');
const cache = require('../lib/cache');
const wikimedia = require('../lib/wikimedia');
const unsplash = require('../lib/unsplash');
const { photoCredit, cardPhoto } = require('../lib/photos');
const { refreshHero } = require('../lib/gallery');
const { wikipediaPhotos, addWikipediaPhoto, unsplashImages } = require('../jobs/images');
const { PLACEHOLDER_URL } = require('../lib/constants');

const PILOT_ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/3/36/2025_Honda_Pilot.jpg?utm_source=en.wikipedia.org';
const MONSTER_THUMB = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/2003_Ducati_Monster_S4R.jpg/3840px-2003_Ducati_Monster_S4R.jpg';
const HERO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/2003_Ducati_Monster_S4R.jpg/1280px-2003_Ducati_Monster_S4R.jpg';

// Stand-in for lib/cache.js: answers by URL (and File: title for Commons)
function fakeWikipedia({ summaries = {}, files = {}, search = {} }) {
  return async (url, { params } = {}) => {
    if (url.includes('/page/summary/')) {
      const title = decodeURIComponent(url.split('/page/summary/')[1]).replace(/_/g, ' ');
      if (!summaries[title]) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      return summaries[title];
    }
    if (url.includes('commons.wikimedia.org')) {
      const info = files[params.titles.replace(/^File:/, '')];
      return { query: { pages: [info ? { imageinfo: [info] } : { missing: true }] } };
    }
    return [params.search, search[params.search] || [], [], []]; // opensearch
  };
}

function commonsInfo(overrides = {}) {
  return {
    mime: 'image/jpeg', width: 1000, height: 750,
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:2025_Honda_Pilot.jpg',
    extmetadata: {
      Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Sig">Sig &amp; Co</a>' },
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }
    },
    ...overrides
  };
}

describe('Wikipedia photos (R2)', function() {
  describe('matching an article to a catalog car', function() {
    it('needs the make and the whole model in the title', function() {
      const yes = [
        ['Porsche Boxster and Cayman', 'Porsche', 'Boxster'],
        ['Cadillac de Ville series', 'Cadillac', 'Deville'],
        ['Kawasaki GPZ305', 'Kawasaki', 'GPZ 305'],
        ['Mercedes-Benz EQB', 'Mercedes-Benz', 'EQB-Class'],
        ['Škoda Superb', 'Škoda', 'Superb']
      ];
      const no = [
        ['BMW R1200GS', 'BMW', 'R 12'], // "R 12" is a prefix of another model
        ['Ford Escort (North America)', 'Mercury', 'Lynx'], // redirect to the Ford twin
        ['Harley-Davidson Sportster', 'Harley-Davidson', 'Nightster'],
        ['Honda Accord', 'Honda', 'Accord Crosstour']
      ];
      for (const [title, make, model] of yes) if (!wikimedia.titleMatches(title, make, model)) throw new Error(`should match: ${title}`);
      for (const [title, make, model] of no) if (wikimedia.titleMatches(title, make, model)) throw new Error(`should not match: ${title}`);
    });

    it('takes a search result only when it names the model exactly', function() {
      if (!wikimedia.sameName('Kawasaki GPZ305', 'Kawasaki', 'GPZ 305')) throw new Error('spacing');
      if (!wikimedia.sameName('Toyota Supra (A80)', 'Toyota', 'Supra')) throw new Error('qualifier');
      if (wikimedia.sameName('BMW M8 GTE', 'BMW', 'M8')) throw new Error('race car variant accepted');
    });

    it('needs the article to be about a vehicle', function() {
      const suv = { title: 'Honda Pilot', description: 'Mid-size crossover SUV', extract: 'The Honda Pilot is…' };
      const band = { title: 'Honda Pilot', description: 'Rock band', extract: 'Honda Pilot are a four-piece band from Leeds.' };
      if (!wikimedia.articleMatches(suv, 'Honda', 'Pilot')) throw new Error('SUV rejected');
      if (wikimedia.articleMatches(band, 'Honda', 'Pilot')) throw new Error('band accepted');
    });
  });

  describe('Commons files and sizes', function() {
    it('reads the Commons file from upload and thumbnail URLs, and nothing else', function() {
      const a = wikimedia.commonsFile(PILOT_ORIGINAL);
      const b = wikimedia.commonsFile(MONSTER_THUMB);
      if (!a || a.hash !== '3/36' || a.file !== '2025_Honda_Pilot.jpg') throw new Error(JSON.stringify(a));
      if (!b || b.hash !== 'b/b0' || b.file !== '2003_Ducati_Monster_S4R.jpg') throw new Error(JSON.stringify(b));
      // English Wikipedia's own uploads are mostly non-free
      if (wikimedia.commonsFile('https://upload.wikimedia.org/wikipedia/en/4/4a/Logo.jpg')) throw new Error('non-free file accepted');
      if (wikimedia.commonsFile('https://example.com/wikipedia/commons/3/36/x.jpg')) throw new Error('other host accepted');
    });

    it('only uses standard thumbnail widths, never upscaling', function() {
      if (wikimedia.fitWidth(1280, 4160) !== 1280) throw new Error('large original');
      if (wikimedia.fitWidth(1280, 1000) !== 960) throw new Error('1000px original');
      if (wikimedia.fitWidth(1280, 400) !== 330) throw new Error('small original');
      if (cardPhoto(HERO) !== HERO.replace(/1280px-/, '500px-')) throw new Error('card not 500px');
      const small = HERO.replace(/1280px-/, '500px-');
      if (cardPhoto(small) !== small) throw new Error('500px thumb changed');
      if (wikimedia.sizedPhoto(HERO, 480) !== HERO) throw new Error('non-standard width used');
      const other = 'https://images.unsplash.com/photo-1?w=1080';
      if (cardPhoto(other) !== other) throw new Error('Unsplash URL changed');
    });

    it('keeps credits as plain text', function() {
      const text = wikimedia.plainText('<a href="//x">Jeremy</a> from Sydney, Australia &amp; <b>friends</b>');
      if (text !== 'Jeremy from Sydney, Australia & friends') throw new Error(text);
    });
  });

  describe('findLeadPhoto', function() {
    let realGet;
    before(function() { realGet = cache.cachedGet; });
    afterEach(function() { cache.cachedGet = realGet; });

    const pilot = {
      type: 'standard', title: 'Honda Pilot', description: 'Mid-size crossover SUV',
      extract: 'The Honda Pilot is a mid-size crossover SUV.', originalimage: { source: PILOT_ORIGINAL, width: 1000, height: 750 }
    };

    it('returns a credited, standard-width Commons photo', async function() {
      cache.cachedGet = fakeWikipedia({ summaries: { 'Honda Pilot': pilot }, files: { '2025_Honda_Pilot.jpg': commonsInfo() } });
      const photo = await wikimedia.findLeadPhoto('Honda', 'Pilot');
      if (!photo) throw new Error('no photo');
      if (photo.url !== 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/2025_Honda_Pilot.jpg/960px-2025_Honda_Pilot.jpg') throw new Error(photo.url);
      if (photo.creditName !== 'Sig & Co' || photo.license !== 'CC BY-SA 4.0') throw new Error(JSON.stringify(photo));
      if (photo.creditUrl !== 'https://commons.wikimedia.org/wiki/File:2025_Honda_Pilot.jpg') throw new Error(photo.creditUrl);
    });

    it('finds an article through search when the direct title misses', async function() {
      const gpz = { ...pilot, title: 'Kawasaki GPZ305', description: 'Motorcycle', extract: 'The Kawasaki GPZ305 is a motorcycle.' };
      cache.cachedGet = fakeWikipedia({
        summaries: { 'Kawasaki GPZ305': gpz, 'Kawasaki GPZ305 Belt Drive': { ...gpz, title: 'Kawasaki GPZ305 Belt Drive' } },
        files: { '2025_Honda_Pilot.jpg': commonsInfo() },
        search: { 'Kawasaki GPZ 305': ['Kawasaki GPZ305 Belt Drive', 'Kawasaki GPZ305'] }
      });
      const photo = await wikimedia.findLeadPhoto('Kawasaki', 'GPZ 305');
      if (!photo || photo.article !== 'Kawasaki GPZ305') throw new Error(JSON.stringify(photo));
    });

    it('skips portrait, non-JPEG, small and missing files', async function() {
      for (const info of [commonsInfo({ width: 750, height: 1000 }), commonsInfo({ mime: 'image/png' }), commonsInfo({ width: 600, height: 400 }), null]) {
        cache.cachedGet = fakeWikipedia({ summaries: { 'Honda Pilot': pilot }, files: info ? { '2025_Honda_Pilot.jpg': info } : {} });
        if (await wikimedia.findLeadPhoto('Honda', 'Pilot')) throw new Error('accepted ' + JSON.stringify(info && { mime: info.mime, width: info.width }));
      }
    });

    it('throws when Wikipedia is unreachable, so the job can retry', async function() {
      cache.cachedGet = async () => { throw Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }); };
      let threw = false;
      try { await wikimedia.findLeadPhoto('Honda', 'Pilot'); } catch (e) { threw = true; }
      if (!threw) throw new Error('outage treated as "no photo"');
    });

    it('maps trim-level names to their series', function() {
      const cases = [
        ['BMW', '525i', '5 Series'], ['BMW', '750Li', '7 Series'], ['BMW', 'M235i', '2 Series'], ['BMW', '325/325e', '3 Series'],
        ['BMW', '633 csi', '6 Series'], ['BMW', 'ActiveHybrid 3', '3 Series'],
        ['BMW', 'M3', null], ['BMW', 'i4', null], ['BMW', 'F 800 GS', null], ['BMW', '1M', null],
        ['Infiniti', 'G35', 'G Line'], ['Infiniti', 'FX35', 'QX70'], ['Infiniti', 'M35h', 'M'], ['Infiniti', 'EX35', null], ['Infiniti', 'Q50', null],
        ['Audi', 'A8 L', 'A8'], ['Audi', 'RS 6 Avant', 'RS 6'], ['Audi', 'A8', null], ['Audi', 'e-tron GT', null],
        ['Toyota', '86', null]
      ];
      for (const [make, model, want] of cases) {
        const got = wikimedia.seriesOf(make, model);
        if (got !== want) throw new Error(`${make} ${model}: ${got}, wanted ${want}`);
      }
    });

    it('falls back to the series article only for a trim still on sale', async function() {
      // "BMW 530i" redirects to the series article, whose title doesn't name the trim
      const series = { ...pilot, title: 'BMW 5 Series', description: 'Executive car', extract: 'The BMW 5 Series is an executive car.' };
      cache.cachedGet = fakeWikipedia({
        summaries: { 'BMW 530i': series, 'BMW 5 Series': series },
        files: { '2025_Honda_Pilot.jpg': commonsInfo() }
      });
      const thisYear = new Date().getFullYear();
      const current = await wikimedia.findLeadPhoto('BMW', '530i', { yearMax: thisYear + 1 });
      if (!current || current.article !== 'BMW 5 Series') throw new Error(JSON.stringify(current));
      if (await wikimedia.findLeadPhoto('BMW', '530i', { yearMax: thisYear - 5 })) throw new Error('old trim got the current generation');
      if (await wikimedia.findLeadPhoto('BMW', '530i')) throw new Error('unknown years got a series photo');
    });
  });

  describe('credits', function() {
    const row = {
      source: 'wikimedia', credit_name: 'Sig & Co', credit_url: 'https://commons.wikimedia.org/wiki/File:X.jpg',
      license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0'
    };
    const render = credit => ejs.renderFile(path.join(__dirname, '../views/partials/photo-credit.ejs'), { credit });

    it('names the author, links the file page and the license', async function() {
      const html = await render(photoCredit(HERO, row));
      for (const part of ['href="https://commons.wikimedia.org/wiki/File:X.jpg"', 'Sig &amp; Co', 'href="https://creativecommons.org/licenses/by-sa/4.0"', 'CC BY-SA 4.0', 'Wikimedia Commons']) {
        if (!html.includes(part)) throw new Error(`missing ${part}: ${html}`);
      }
    });

    it('leaves out the file page (it names the car) when asked', async function() {
      const credit = photoCredit(HERO, row, { linkSource: false });
      const html = await render(credit);
      if (credit.url !== null || html.includes('File:X.jpg')) throw new Error(html);
      if (!html.includes('CC BY-SA 4.0')) throw new Error('license missing');
    });
  });

  describe('the photo job', function() {
    let realFind;
    let found;
    const lookups = [];
    before(async function() {
      realFind = wikimedia.findLeadPhoto;
      await db.car.update({ wiki_checked: true }, { where: {} }); // only this suite's cars are pending
    });
    after(function() { wikimedia.findLeadPhoto = realFind; });
    beforeEach(function() {
      found = {};
      lookups.length = 0;
      wikimedia.findLeadPhoto = async (make, model) => {
        lookups.push(model);
        const photo = found[model];
        if (photo instanceof Error) throw photo;
        return photo || null;
      };
    });

    const photoFor = model => ({
      url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${model}.jpg/1280px-${model}.jpg`,
      creditName: 'Sig', creditUrl: `https://commons.wikimedia.org/wiki/File:${model}.jpg`,
      license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0'
    });
    const newCar = (model, attrs = {}) => db.car.create({ make: 'Lancia', model, favcount: 0, updated_img: false, image: PLACEHOLDER_URL, ...attrs });

    it('makes the Wikipedia photo the hero of a placeholder car, credited', async function() {
      const car = await newCar('Wiki Delta');
      found['Wiki Delta'] = photoFor('Wiki_Delta');
      await wikipediaPhotos(50, { delayMs: 0 });
      await car.reload();
      if (car.image !== found['Wiki Delta'].url || !car.updated_img || !car.wiki_checked) throw new Error(JSON.stringify(car.toJSON()));
      const img = await db.car_image.findOne({ where: { carId: car.id, url: car.image } });
      if (img.source !== 'wikimedia' || img.license !== 'CC BY 2.0' || img.credit_name !== 'Sig') throw new Error(JSON.stringify(img.toJSON()));
    });

    it('replaces an unvoted Unsplash hero but keeps it in the gallery', async function() {
      const unsplashUrl = 'https://images.unsplash.com/photo-wiki-stratos?w=1080';
      const car = await newCar('Wiki Stratos', { image: unsplashUrl, updated_img: true, wiki_checked: false });
      await db.car_image.create({ carId: car.id, url: unsplashUrl, source: 'unsplash' });
      await addWikipediaPhoto(car, photoFor('Wiki_Stratos'));
      await car.reload();
      if (car.image !== photoFor('Wiki_Stratos').url) throw new Error('hero not replaced');
      if (!await db.car_image.findOne({ where: { carId: car.id, url: unsplashUrl } })) throw new Error('Unsplash photo removed');
    });

    it("keeps a hero people chose: an approved proposal, or a photo with votes", async function() {
      const chosen = 'https://example.com/fulvia.jpg';
      const car = await newCar('Wiki Fulvia', { image: chosen, updated_img: true });
      await db.car_image.create({ carId: car.id, url: chosen, source: 'user' });
      await addWikipediaPhoto(car, photoFor('Wiki_Fulvia'));
      await car.reload();
      if (car.image !== chosen) throw new Error('approved proposal replaced');

      const liked = 'https://images.unsplash.com/photo-wiki-thema?w=1080';
      const car2 = await newCar('Wiki Thema', { image: liked, updated_img: true });
      await db.car_image.create({ carId: car2.id, url: liked, source: 'unsplash', score: 2 });
      await addWikipediaPhoto(car2, photoFor('Wiki_Thema'));
      await car2.reload();
      if (car2.image !== liked) throw new Error('upvoted photo replaced');
      if (!await db.car_image.findOne({ where: { carId: car2.id, source: 'wikimedia' } })) throw new Error('Wikipedia photo not in gallery');
    });

    it('marks misses checked and retries failures next run', async function() {
      const miss = await newCar('Wiki Beta');
      const fail = await newCar('Wiki Gamma');
      found['Wiki Gamma'] = new Error('Service Unavailable');
      await wikipediaPhotos(50, { delayMs: 0 });
      await miss.reload();
      await fail.reload();
      if (!miss.wiki_checked || miss.image !== PLACEHOLDER_URL) throw new Error('miss not marked');
      if (fail.wiki_checked) throw new Error('failed lookup marked checked');
    });

    it('stops the run after three failures in a row', async function() {
      await db.car.update({ wiki_checked: true }, { where: {} });
      for (const model of ['Wiki F1', 'Wiki F2', 'Wiki F3', 'Wiki F4']) {
        await newCar(model);
        found[model] = new Error('Too Many Requests');
      }
      await wikipediaPhotos(50, { delayMs: 0 });
      if (lookups.length !== 3) throw new Error(`looked up ${lookups.length} cars`);
    });
  });

  describe('hero ties', function() {
    it('keep the current hero instead of reverting to the oldest photo', async function() {
      const car = await db.car.create({ make: 'Lancia', model: 'Wiki Ypsilon', favcount: 0, updated_img: true, image: PLACEHOLDER_URL });
      await db.car_image.create({ carId: car.id, url: 'https://example.com/old.jpg', source: 'unsplash' });
      await db.car_image.create({ carId: car.id, url: HERO, source: 'wikimedia' });
      await car.update({ image: HERO });
      await refreshHero(car.id);
      await car.reload();
      if (car.image !== HERO) throw new Error('hero reverted to ' + car.image);
    });
  });

  describe('Unsplash as the fallback', function() {
    let realSearch;
    let realKey;
    const searched = [];
    before(function() {
      realSearch = unsplash.searchCarPhoto;
      realKey = process.env.UKEY;
      process.env.UKEY = 'test';
      unsplash.searchCarPhoto = async (make, model) => { searched.push(model); return null; };
    });
    after(function() {
      unsplash.searchCarPhoto = realSearch;
      if (realKey === undefined) delete process.env.UKEY; else process.env.UKEY = realKey;
    });

    it('only searches cars Wikipedia has already been asked about', async function() {
      await db.car.update({ wiki_checked: false }, { where: {} });
      await db.car.create({ make: 'Lancia', model: 'Wiki Kappa', favcount: 0, updated_img: false, image: PLACEHOLDER_URL, wiki_checked: false });
      await db.car.create({ make: 'Lancia', model: 'Wiki Musa', favcount: 0, updated_img: false, image: PLACEHOLDER_URL, wiki_checked: true });
      await unsplashImages();
      if (searched.includes('Wiki Kappa')) throw new Error('searched before the Wikipedia lookup');
      if (!searched.includes('Wiki Musa')) throw new Error('checked car not searched');
    });
  });
});
