const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');
const db = require('../models');
const { PLACEHOLDER_URL } = require('../lib/constants');
const { getCsrfToken } = require('./helpers');

describe('Public sightings feed', function () {
  const knownUsers = [];
  const knownCars = [];
  const make = 'Activity Fixture';
  const baseTime = Date.UTC(2099, 0, 1);

  async function owner(label, garagePublic, username = 'activity_' + label) {
    const row = await db.user.create({
      email: 'activity-' + label + '@example.test',
      name: 'Activity Private Name ' + label,
      username,
      garagePublic
    }, { hooks: false });
    knownUsers.push(row.id);
    return row;
  }

  async function cars(...models) {
    const rows = await db.car.bulkCreate(models.map(model => ({ make, model })));
    knownCars.push(...rows.map(row => row.id));
    return rows;
  }

  function spot(user, car, timestamp, extra = {}) {
    return db.spotting.create({
      userId: user.id, carId: car.id, createdAt: new Date(baseTime + timestamp), ...extra
    });
  }

  async function feed() {
    const res = await request(app).get('/activity').expect(200);
    const directives = (res.headers['cache-control'] || '').split(/\s*,\s*/i);
    assert.ok(directives.includes('private') && directives.includes('no-store'), res.headers['cache-control']);
    assert.match(res.text, /<h1\b[^>]*>\s*Recent sightings\s*<\/h1>/i);
    return res.text;
  }

  const detail = car => '/cars/car?make=' + encodeURIComponent(car.make) + '&model=' + encodeURIComponent(car.model);
  const modelMarker = car => 'model=' + encodeURIComponent(car.model);

  function sightingRow(html, car) {
    return (html.match(/<li class="activity-sighting">[\s\S]*?<\/li>/g) || [])
      .find(row => row.includes(modelMarker(car))) || '';
  }

  afterEach(async function () {
    if (knownUsers.length) await db.user.destroy({ where: { id: knownUsers.splice(0) } });
    if (knownCars.length) await db.car.destroy({ where: { id: knownCars.splice(0) } });
  });

  it('shows a useful empty state when there are no public sightings', async function () {
    // Isolate the view's empty state from fixtures left in the shared test DB.
    const findSpots = db.spotting.findAll;
    const findRecords = db.user.findAll;
    db.spotting.findAll = async () => [];
    db.user.findAll = async () => [];
    try {
      const html = await feed();
      assert.match(html, /id="activity-empty"/);
      assert.doesNotMatch(html, /id="quiz-records"/);
    } finally {
      db.spotting.findAll = findSpots;
      db.user.findAll = findRecords;
    }
  });

  it('shows only opted-in handles and car links, never private metadata or photos', async function () {
    const publicOwner = await owner('visible', true);
    const privateOwner = await owner('hidden', false);
    const unsetOwner = await owner('unset', true, null);
    const blankOwner = await owner('blank', true, null);
    // Simulate legacy data bypassing the normal handle setter.
    await db.sequelize.query('UPDATE users SET username = :username WHERE id = :id', {
      replacements: { id: blankOwner.id, username: '' }
    });
    const [visible, hidden, unset, blank] = await cars('Visible Sighting', 'Private Sighting', 'Unset Handle Sighting', 'Blank Handle Sighting');
    await spot(publicOwner, visible, 0, {
      notes: 'activity-secret-notes',
      location: 'activity-secret-location',
      imageUrl: 'https://images.example.test/activity-private-photo.jpg'
    });
    await spot(privateOwner, hidden, 1);
    await spot(unsetOwner, unset, 2);
    await spot(blankOwner, blank, 3);

    const html = await feed();
    assert.match(html, /id="activity-feed"/);
    assert.ok(html.includes('@activity_visible'));
    assert.ok(html.includes('href="/u/activity_visible"'));
    assert.match(html, /<time datetime="2099-01-01">Jan 1, 2099<\/time>/);
    // EJS escapes the ampersand in an HTML attribute.
    assert.ok(html.includes('href="' + detail(visible).replace('&', '&amp;') + '"'));
    for (const secret of [publicOwner.email, publicOwner.name, privateOwner.email,
      privateOwner.name, privateOwner.username, unsetOwner.email, unsetOwner.name, blankOwner.email,
      blankOwner.name, hidden.model, unset.model, blank.model, 'activity-secret-notes',
      'activity-secret-location', 'activity-private-photo.jpg']) {
      assert.ok(!html.includes(secret), 'activity feed exposed ' + secret);
    }
  });

  it('sorts by time then id, limits results, and drops hidden or deleted sightings on the next GET', async function () {
    const first = await owner('first', true);
    const second = await owner('second', true);
    const models = await cars(...Array.from({ length: 13 }, (_, i) => 'Ordered Sighting ' + String(i).padStart(2, '0')));
    const sightings = [];
    // Insert model 0 last so ordering by id alone would put the oldest first.
    for (const i of [...models.keys()].slice(1).concat(0)) {
      sightings[i] = await spot(i === 12 ? second : first, models[i], Math.min(i, 11));
    }
    // Model 12 has the same timestamp as model 11, but a higher id.
    const initial = await feed();
    const classes = initial.match(/class="[^"]*"/g) || [];
    assert.equal(classes.filter(value => value.slice(7, -1).split(/\s+/).includes('activity-sighting')).length, 12);
    const positions = models.map(model => initial.indexOf(modelMarker(model)));
    assert.equal(positions[0], -1);
    assert.ok(positions.slice(1).every((position, i) => position >= 0 && (i === 0 || position < positions[i])));
    // The oldest sighting is outside the feed, so none of this owner's
    // visible newer sightings should be marked as their first.
    assert.doesNotMatch(sightingRow(initial, models[1]), /class="activity-first-spot"/);
    assert.match(sightingRow(initial, models[12]), /class="activity-first-spot"/);

    await second.update({ garagePublic: false });
    const hidden = await feed();
    assert.ok(!hidden.includes(modelMarker(models[12])));
    assert.ok(!hidden.includes('@activity_second'));
    assert.ok(hidden.includes(modelMarker(models[0])));
    assert.match(sightingRow(hidden, models[0]), /class="activity-first-spot"/);

    await sightings[11].destroy();
    const deleted = await feed();
    assert.ok(!deleted.includes(modelMarker(models[11])));
    assert.ok(deleted.includes(modelMarker(models[10])));
  });

  it('marks only the earliest retained public sighting and follows source and visibility changes', async function () {
    const publicOwner = await owner('first_badge', true);
    const privateOwner = await owner('private_badge', false);
    const [earliest, tied, later, privateModel] = await cars('First Badge Oldest', 'First Badge Tie', 'First Badge Later', 'First Badge Hidden');
    const first = await spot(publicOwner, earliest, 100);
    await spot(publicOwner, tied, 100);
    await spot(publicOwner, later, 200);
    await spot(privateOwner, privateModel, 10, { notes: 'private-first-badge-note' });

    const original = await feed();
    const firstRow = sightingRow(original, earliest);
    assert.match(firstRow, /class="activity-first-spot"/);
    assert.match(firstRow, /First Spot/);
    assert.match(firstRow, /First sighting still in this garage/);
    assert.match(firstRow, /datetime="2099-01-01"/);
    assert.doesNotMatch(firstRow, /2099-01-01T/);
    for (const model of [tied, later]) {
      assert.ok(sightingRow(original, model));
      assert.doesNotMatch(sightingRow(original, model), /class="activity-first-spot"/);
    }
    assert.doesNotMatch(original, /activity_private_badge|private-first-badge-note|First Badge Hidden/);

    await publicOwner.update({ username: 'activity_badge_renamed' });
    const renamed = await feed();
    assert.match(sightingRow(renamed, earliest), /href="\/u\/activity_badge_renamed"/);
    assert.doesNotMatch(renamed, /activity_first_badge/);

    await first.destroy();
    const deleted = await feed();
    assert.equal(sightingRow(deleted, earliest), '');
    assert.match(sightingRow(deleted, tied), /class="activity-first-spot"/);
    assert.doesNotMatch(sightingRow(deleted, later), /class="activity-first-spot"/);

    await publicOwner.update({ garagePublic: false });
    const hidden = await feed();
    assert.equal(sightingRow(hidden, tied), '');
    assert.doesNotMatch(hidden, /activity_badge_renamed/);
  });

  it('shows dated records from public garages in time and ID order, and hides them on unpublish', async function () {
    const latest = new Date(Date.now() - 86_400_000);
    latest.setUTCHours(0, 0, 0, 123);
    const older = new Date(latest.getTime() - 86_400_000);
    const first = await owner('quiz_tie_first', true);
    const second = await owner('quiz_tie_second', true);
    // The older record has a higher ID, so ID order alone gets this wrong.
    const previous = await owner('quiz_older', true);
    const hidden = await owner('quiz_hidden', false);
    const legacy = await owner('quiz_legacy', true);
    const noHandle = await owner('quiz_unset', true, null);
    const blank = await owner('quiz_blank', true, null);
    await Promise.all([
      first.update({ quizBest: 17, quizBestAt: latest }),
      second.update({ quizBest: 23, quizBestAt: latest }),
      previous.update({ quizBest: 39, quizBestAt: older }),
      hidden.update({ quizBest: 151, quizBestAt: latest }),
      legacy.update({ quizBest: 152 }),
      noHandle.update({ quizBest: 153, quizBestAt: latest }),
      blank.update({ quizBest: 154, quizBestAt: latest })
    ]);
    await db.sequelize.query('UPDATE users SET username = :username WHERE id = :id', {
      replacements: { id: blank.id, username: '' }
    });

    const page = await feed();
    assert.match(page, /id="quiz-records"/);
    const links = [second, first, previous].map(user => page.indexOf(`href="/u/${user.username}"`));
    assert.ok(links[0] >= 0 && links[0] < links[1] && links[1] < links[2]);
    for (const score of [17, 23, 39]) assert.ok(page.includes(`${score} in a row`));
    assert.ok(page.includes(`datetime="${latest.toISOString().slice(0, 10)}"`));
    assert.ok(!page.includes(latest.toISOString()));
    for (const user of [first, second, previous, hidden, legacy, noHandle, blank]) {
      assert.ok(!page.includes(user.email) && !page.includes(user.name));
    }
    for (const excluded of [hidden.username, legacy.username, '151 in a row', '152 in a row', '153 in a row', '154 in a row']) {
      assert.ok(!page.includes(excluded), `activity feed exposed ${excluded}`);
    }

    await second.update({ garagePublic: false });
    const unpublished = await feed();
    assert.ok(!unpublished.includes(second.username) && !unpublished.includes('23 in a row'));
    assert.ok(unpublished.includes(first.username));
  });

  describe('Spot of the Day', function () {
    const dayMs = 86_400_000;
    const ballotPath = '/activity#spot-of-the-day';
    const photo = name => `https://images.example.test/activity-vote-${name}.jpg`;
    const utcDay = date => date.toISOString().slice(0, 10);

    function recentSpot(user, car, createdAt, imageUrl) {
      return spot(user, car, 0, { createdAt, imageUrl });
    }

    async function signIn(user) {
      const password = 'activity-vote-password';
      await user.update({ password, emailVerified: true });
      const agent = request.agent(app);
      const _csrf = await getCsrfToken(agent);
      await agent.post('/auth/login').type('form').send({ email: user.email, password, _csrf })
        .expect(302).expect('Location', '/');
      return { agent, _csrf: await getCsrfToken(agent) };
    }

    function postVote(agent, fields) {
      return agent.post('/activity/vote').type('form').send(fields);
    }

    it('counts one current UTC vote per member and lets them switch or withdraw it', async function () {
      const now = new Date();
      const day = utcDay(now);
      const midnight = Date.parse(day);
      const yesterday = utcDay(new Date(midnight - dayMs));
      const voter = await owner('voter', false);
      const submitter = await owner('entrant', true);
      const { agent, _csrf } = await signIn(voter);
      const [firstCar, secondCar] = await cars('Vote First', 'Vote Second');
      const first = await recentSpot(submitter, firstCar, new Date(midnight), photo('first'));
      const second = await recentSpot(submitter, secondCar, new Date(midnight - 6 * dayMs), photo('second'));
      await db.spot_vote.create({ userId: voter.id, spottingId: second.id, voteDay: yesterday });

      const ballot = await agent.get('/activity').expect(200);
      assert.match(ballot.text, /name="spottingId"/);
      assert.ok(ballot.text.includes(`name="day" value="${day}"`));
      assert.ok(ballot.text.includes(photo('first')) && ballot.text.includes(photo('second')));
      assert.doesNotMatch(ballot.text, /Leading today/i);

      const fields = { spottingId: first.id, action: 'vote', day, _csrf };
      const submit = overrides => postVote(agent, { ...fields, ...overrides }).expect(302).expect('Location', ballotPath);
      await postVote(agent, { ...fields, day: yesterday }).expect(409);
      await postVote(agent, { ...fields, spottingId: 0 }).expect(400);
      await postVote(agent, { ...fields, _csrf: undefined }).set('X-Requested-With', 'XMLHttpRequest').expect(403);
      const guest = request.agent(app);
      await postVote(guest, { ...fields, _csrf: await getCsrfToken(guest) }).expect(302).expect('Location', '/auth/login');

      const today = { userId: voter.id, voteDay: day };
      await Promise.all([submit({}), submit({})]);
      assert.deepEqual((await db.spot_vote.findAll({ where: today })).map(vote => vote.spottingId), [first.id]);
      const publicFeed = await feed();
      assert.match(publicFeed, /Leading today/i);
      assert.match(publicFeed, /\b1 vote\b/i);
      assert.ok(!publicFeed.includes(voter.username) && !publicFeed.includes(voter.email));

      await submit({ spottingId: second.id });
      assert.deepEqual((await db.spot_vote.findAll({ where: today })).map(vote => vote.spottingId), [second.id]);
      await submit({ spottingId: second.id, action: 'withdraw' });
      assert.equal(await db.spot_vote.count({ where: today }), 0);
      assert.equal(await db.spot_vote.count({ where: { userId: voter.id, voteDay: yesterday } }), 1);
      assert.doesNotMatch(await feed(), /Leading today/i);
    });

    it('allows withdrawal when the voted sighting is no longer public', async function () {
      const day = utcDay(new Date());
      const yesterday = utcDay(new Date(Date.parse(day) - dayMs));
      const voter = await owner('unavailable_voter', false);
      const submitter = await owner('unavailable_submitter', true);
      const { agent, _csrf } = await signIn(voter);
      const [car, replacement] = await cars('Hidden Vote Fixture', 'Replacement Vote Fixture');
      const image = photo('withdraw-hidden');
      const sighting = await recentSpot(submitter, car, new Date(day), image);
      await postVote(agent, { spottingId: sighting.id, day, action: 'vote', _csrf })
        .expect(302).expect('Location', ballotPath);
      const today = { userId: voter.id, voteDay: day };
      assert.equal(await db.spot_vote.count({ where: today }), 1);

      await submitter.update({ garagePublic: false });
      const hidden = await agent.get('/activity').expect(200);
      for (const value of [image, submitter.username, submitter.name, submitter.email, car.model, modelMarker(car)]) {
        assert.ok(!hidden.text.includes(value), 'activity exposed ' + value);
      }
      assert.match(hidden.text, /id="spot-of-the-day"/);
      const fallback = hidden.text.match(/<form\b[^>]*action="\/activity\/vote"[^>]*>[\s\S]*?<\/form>/)?.[0];
      assert.ok(fallback, 'missing withdrawal form for unavailable sighting');
      assert.match(fallback, /^<form\b[^>]*method="post"/i);
      assert.match(fallback, /name="action" value="withdraw-unavailable"[^>]*>\s*Withdraw your vote\s*<\/button>/);
      assert.ok(fallback.includes(`name="day" value="${day}"`));
      assert.doesNotMatch(hidden.text, /name="spottingId"/);
      assert.ok(!fallback.includes(`value="${sighting.id}"`));
      const withdrawalToken = fallback.match(/name="withdrawalToken" value="([a-f0-9]{64})"/)?.[1];
      const formCsrf = fallback.match(/name="_csrf" value="([^"]+)"/)?.[1];
      assert.ok(withdrawalToken && formCsrf, 'missing withdrawal token or CSRF token');
      assert.doesNotMatch(await feed(), /withdraw-unavailable/);

      const fields = { day, action: 'withdraw-unavailable', withdrawalToken, _csrf: formCsrf };
      await postVote(agent, { ...fields, day: yesterday }).expect(409);
      assert.equal(await db.spot_vote.count({ where: today }), 1);

      await submitter.update({ garagePublic: true });
      const newer = await recentSpot(submitter, replacement, new Date(day), photo('withdraw-replacement'));
      await postVote(agent, { spottingId: newer.id, day, action: 'vote', _csrf })
        .expect(302).expect('Location', ballotPath);
      await submitter.update({ garagePublic: false });
      await postVote(agent, fields).expect(302).expect('Location', ballotPath);
      assert.equal((await db.spot_vote.findOne({ where: today }))?.spottingId, newer.id);

      const current = await agent.get('/activity').expect(200);
      const currentToken = current.text.match(/name="withdrawalToken" value="([a-f0-9]{64})"/)?.[1];
      assert.ok(currentToken && currentToken !== withdrawalToken);
      await postVote(agent, { ...fields, withdrawalToken: currentToken, _csrf: undefined })
        .set('X-Requested-With', 'XMLHttpRequest').expect(403);
      await postVote(agent, { ...fields, withdrawalToken: currentToken }).expect(302).expect('Location', ballotPath);
      assert.equal(await db.spot_vote.count({ where: today }), 0);

      await submitter.update({ garagePublic: true });
      const republished = await feed();
      assert.ok(republished.includes(image));
      assert.doesNotMatch(republished, /Leading today/i);
    });

    it('keeps nonpublic and ineligible photos out of the ballot and rejects direct votes for them', async function () {
      const now = new Date();
      const day = utcDay(now);
      const midnight = Date.parse(day);
      const voter = await owner('owns_candidate', true);
      const submitter = await owner('can_hide', true);
      const privateOwner = await owner('private_candidate', false);
      const { agent, _csrf } = await signIn(voter);
      const [validCar, ownedCar, privateCar, photoLessCar, retiredCar, oldCar, futureCar, placeholderCar] = await cars(
        'Candidate', 'Own Candidate', 'Private Candidate', 'No Photo Candidate', 'Retired Candidate',
        'Expired Candidate', 'Future Candidate', 'Placeholder Candidate'
      );
      const valid = await recentSpot(submitter, validCar, new Date(midnight), photo('visible'));
      const excluded = await Promise.all([
        recentSpot(voter, ownedCar, new Date(midnight), photo('own')),
        recentSpot(privateOwner, privateCar, new Date(midnight), photo('private')),
        recentSpot(submitter, photoLessCar, new Date(midnight), null),
        recentSpot(submitter, retiredCar, new Date(midnight), 'https://images.unsplash.com/retired-activity.jpg'),
        recentSpot(submitter, oldCar, new Date(midnight - 6 * dayMs - 1), photo('expired')),
        recentSpot(submitter, futureCar, new Date(now.getTime() + dayMs), photo('future')),
        recentSpot(submitter, placeholderCar, new Date(midnight), PLACEHOLDER_URL)
      ]);
      const response = await feed();
      assert.ok(response.includes(photo('visible')));
      for (const url of [photo('private'), 'retired-activity.jpg', photo('expired'), photo('future'), PLACEHOLDER_URL]) {
        assert.ok(!response.includes(url), `activity feed exposed ${url}`);
      }

      const vote = spottingId => postVote(agent, { spottingId, day, action: 'vote', _csrf });
      for (const { id } of excluded) await vote(id).expect(404);

      // Twelve newer public sightings fill the feed, even without eligible photos.
      const overflow = await recentSpot(submitter, validCar, new Date(midnight - dayMs), photo('overflow'));
      await db.spotting.bulkCreate(Array.from({ length: 6 }, () => ({
        userId: submitter.id, carId: validCar.id, createdAt: new Date(midnight)
      })));
      assert.ok(!(await feed()).includes(photo('overflow')));
      await vote(overflow.id).expect(404);
      assert.equal(await db.spot_vote.count({ where: { userId: voter.id, voteDay: day } }), 0);

      await vote(valid.id).expect(302).expect('Location', ballotPath);
      await submitter.update({ garagePublic: false });
      const hidden = await feed();
      assert.ok(!hidden.includes(photo('visible')) && !hidden.includes(submitter.username));
      assert.doesNotMatch(hidden, /Leading today/i);
      await vote(valid.id).expect(404);
    });
  });
});
