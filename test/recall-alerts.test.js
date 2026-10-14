const request = require('supertest');
const app = require('../server');
const db = require('../models');
const nhtsa = require('../lib/nhtsa');
const email = require('../config/email');
const { getCsrfToken, createVerifiedUser } = require('./helpers');
const { checkRecalls, unsubscribeUrl, RECHECK_DAYS } = require('../jobs/recalls');

const recall = campaign => ({ campaign, component: 'STEERING', summary: `Recall ${campaign}`, consequence: '', remedy: '', parkIt: false });

describe('Recall alerts (R5)', function() {
  const agent = request.agent(app);
  let owner, other, realGetRecalls, realSend;
  let recalls; // "make model year" → recalls NHTSA returns
  const sent = [];
  const longAgo = () => new Date(Date.now() - (RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000);

  before(async function() {
    owner = await createVerifiedUser(agent, db, { email: 'recalls@example.com', name: 'Rhea' });
    other = await db.user.create({ name: 'Off', email: 'no-alerts@example.com', password: 'password123', emailVerified: true });
    realGetRecalls = nhtsa.getRecalls;
    realSend = email.sendRecallAlertEmail;
    nhtsa.getRecalls = async (make, model, year) => {
      const r = recalls[`${make} ${model} ${year}`];
      if (r instanceof Error) throw r;
      return r || [];
    };
    email.sendRecallAlertEmail = async (to, name, cars, unsubscribe) => { sent.push({ to, cars, unsubscribe }); };
  });
  after(function() {
    nhtsa.getRecalls = realGetRecalls;
    email.sendRecallAlertEmail = realSend;
  });
  beforeEach(function() { recalls = {}; sent.length = 0; });

  it('is off by default and turned on from garage settings', async function() {
    if (owner.recallAlerts) throw new Error('on by default');
    const token = await getCsrfToken(agent, '/garage');
    await agent.post('/garage/settings').type('form').send({ recallAlerts: 'on', _csrf: token }).expect(302);
    await owner.reload();
    if (!owner.recallAlerts) throw new Error('not turned on');
    const page = await agent.get('/garage').expect(200);
    if (!/id="recallAlerts" name="recallAlerts" checked/.test(page.text)) throw new Error('checkbox not shown checked');
  });

  it('records existing recalls on the first check without emailing about them', async function() {
    const car = await db.user_car.create({ userId: owner.id, make: 'Honda', model: 'Civic', year: '2016' });
    recalls['Honda Civic 2016'] = [recall('16V001'), recall('17V002')];
    await checkRecalls({ delayMs: 0 });
    await car.reload();
    if (sent.length) throw new Error('emailed about recalls already out');
    if (car.recalls_seen.join() !== '16V001,17V002' || !car.recalls_checked_at) throw new Error(JSON.stringify(car.toJSON()));
  });

  it('emails only new campaigns, once, a week later', async function() {
    const car = await db.user_car.findOne({ where: { userId: owner.id, model: 'Civic' } });
    recalls['Honda Civic 2016'] = [recall('16V001'), recall('17V002'), recall('26V999')];

    await checkRecalls({ delayMs: 0 });
    if (sent.length) throw new Error('checked again before a week passed');

    await car.update({ recalls_checked_at: longAgo() });
    await checkRecalls({ delayMs: 0 });
    if (sent.length !== 1 || sent[0].to !== 'recalls@example.com') throw new Error('emails: ' + JSON.stringify(sent));
    const listed = sent[0].cars[0];
    if (listed.car !== '2016 Honda Civic' || listed.recalls.map(r => r.campaign).join() !== '26V999') throw new Error(JSON.stringify(listed));
    if (!sent[0].unsubscribe.includes(`/auth/recall-alerts/off?u=${owner.id}&t=`)) throw new Error('no unsubscribe link');

    sent.length = 0;
    await car.update({ recalls_checked_at: longAgo() });
    await checkRecalls({ delayMs: 0 });
    if (sent.length) throw new Error('same recall emailed twice');
  });

  it('skips owners without alerts and retries a failed lookup', async function() {
    const theirs = await db.user_car.create({ userId: other.id, make: 'Ford', model: 'Focus', year: '2014', recalls_seen: [] });
    recalls['Ford Focus 2014'] = [recall('14V100')];
    const flaky = await db.user_car.create({ userId: owner.id, make: 'Mazda', model: 'MX-5', year: '2019' });
    recalls['Mazda MX-5 2019'] = new Error('NHTSA down');
    await checkRecalls({ delayMs: 0 });
    await theirs.reload(); await flaky.reload();
    if (sent.length || theirs.recalls_checked_at) throw new Error('opted-out owner checked');
    if (flaky.recalls_checked_at) throw new Error('failed lookup marked checked');
  });

  it('retries a failed grouped alert without acknowledging either car, then records provider acceptance', async function() {
    const retryOwner = await db.user.create({
      name: 'Retry', email: 'recall-delivery-retry@example.com', password: 'password123',
      emailVerified: true, recallAlerts: true
    });
    const acceptedOwner = await db.user.create({
      name: 'Accepted', email: 'recall-delivery-accepted@example.com', password: 'password123',
      emailVerified: true, recallAlerts: true
    });
    const checkedBefore = longAgo();
    const retryCars = await db.user_car.bulkCreate([
      { userId: retryOwner.id, make: 'Honda', model: 'Accord', year: '2018', recalls_seen: ['18V001'], recalls_checked_at: checkedBefore },
      { userId: retryOwner.id, make: 'Toyota', model: 'RAV4', year: '2021', recalls_seen: ['21V002'], recalls_checked_at: checkedBefore }
    ], { returning: true });
    const acceptedCar = await db.user_car.create({
      userId: acceptedOwner.id, make: 'Ford', model: 'Escape', year: '2018',
      recalls_seen: ['18V003'], recalls_checked_at: checkedBefore
    });
    recalls['Honda Accord 2018'] = [recall('18V001'), recall('26V101')];
    recalls['Toyota RAV4 2021'] = [recall('21V002'), recall('26V102')];
    recalls['Ford Escape 2018'] = [recall('18V003'), recall('26V103')];

    const previousSend = email.sendRecallAlertEmail;
    const attempts = [];
    let failDelivery = true;
    email.sendRecallAlertEmail = async (to, name, list, unsubscribe) => {
      attempts.push({ to, list });
      if (to === retryOwner.email) {
        // No campaign/timestamp can be acknowledged before this owner's send.
        await Promise.all(retryCars.map(car => car.reload()));
        if (retryCars[0].recalls_seen.join() !== '18V001' || retryCars[1].recalls_seen.join() !== '21V002') {
          throw new Error('campaigns acknowledged before provider acceptance');
        }
        if (retryCars.some(car => car.recalls_checked_at.getTime() !== checkedBefore.getTime())) {
          throw new Error('timestamp acknowledged before provider acceptance');
        }
        if (failDelivery) throw new Error('Transport unavailable');
      }
      return previousSend(to, name, list, unsubscribe);
    };
    try {
      const failed = await checkRecalls({ delayMs: 0 });
      if (failed.emailed !== 1 || sent.length !== 1 || sent[0].to !== acceptedOwner.email) {
        throw new Error('failed sends counted as accepted');
      }
      const grouped = attempts.find(attempt => attempt.to === retryOwner.email);
      if (!grouped || grouped.list.length !== 2 || grouped.list.flatMap(car => car.recalls.map(r => r.campaign)).sort().join() !== '26V101,26V102') {
        throw new Error('new recalls were not grouped by owner');
      }
      await Promise.all(retryCars.map(car => car.reload()));
      if (retryCars[0].recalls_seen.join() !== '18V001' || retryCars[1].recalls_seen.join() !== '21V002' ||
          retryCars.some(car => car.recalls_checked_at.getTime() !== checkedBefore.getTime())) {
        throw new Error('failed send changed pending state');
      }
      await acceptedCar.reload();
      if (acceptedCar.recalls_seen.join() !== '18V003,26V103' || acceptedCar.recalls_checked_at <= checkedBefore) {
        throw new Error('accepted message was not acknowledged');
      }

      failDelivery = false;
      sent.length = 0;
      const retried = await checkRecalls({ delayMs: 0 });
      if (retried.emailed !== 1 || sent.length !== 1 || sent[0].to !== retryOwner.email || sent[0].cars.length !== 2) {
        throw new Error('failed grouped alert was not retried');
      }
      await Promise.all(retryCars.map(car => car.reload()));
      if (retryCars[0].recalls_seen.join() !== '18V001,26V101' || retryCars[1].recalls_seen.join() !== '21V002,26V102' ||
          retryCars.some(car => car.recalls_checked_at <= checkedBefore)) {
        throw new Error('successful retry was not acknowledged');
      }

      // Even when due again, the successfully accepted campaigns stay seen.
      for (const car of retryCars) await car.update({ recalls_checked_at: longAgo() });
      sent.length = 0;
      const repeated = await checkRecalls({ delayMs: 0 });
      if (repeated.emailed !== 0 || sent.length) throw new Error('successful alert was sent again');
    } finally {
      email.sendRecallAlertEmail = previousSend;
    }
  });

  it('rolls back every grouped acknowledgement if one car update fails after provider acceptance', async function() {
    const retryOwner = await db.user.create({
      name: 'Rollback', email: 'recall-acknowledgement-retry@example.com', password: 'password123',
      emailVerified: true, recallAlerts: true
    });
    const checkedBefore = longAgo();
    const cars = await db.user_car.bulkCreate([
      { userId: retryOwner.id, make: 'Volvo', model: 'V60', year: '2020', recalls_seen: ['20V001'], recalls_checked_at: checkedBefore },
      { userId: retryOwner.id, make: 'Mazda', model: 'CX-5', year: '2020', recalls_seen: ['20V002'], recalls_checked_at: checkedBefore }
    ], { returning: true });
    recalls['Volvo V60 2020'] = [recall('20V001'), recall('26V201')];
    recalls['Mazda CX-5 2020'] = [recall('20V002'), recall('26V202')];
    let failAcknowledgement = true;
    db.user_car.addHook('beforeUpdate', 'recall-acknowledgement-failure', car => {
      if (failAcknowledgement && car.id === cars[1].id) throw new Error('Database write unavailable');
    });
    try {
      const failed = await checkRecalls({ delayMs: 0 });
      if (failed.emailed !== 1 || sent.length !== 1 || sent[0].cars.length !== 2) {
        throw new Error('provider acceptance was not counted');
      }
      await Promise.all(cars.map(car => car.reload()));
      if (cars[0].recalls_seen.join() !== '20V001' || cars[1].recalls_seen.join() !== '20V002' ||
          cars.some(car => car.recalls_checked_at.getTime() !== checkedBefore.getTime())) {
        throw new Error('grouped acknowledgement was partially committed');
      }

      // Acceptance followed by a DB failure intentionally retries the whole
      // group: at-least-once alerts can duplicate, but campaigns cannot be lost.
      failAcknowledgement = false;
      sent.length = 0;
      const retried = await checkRecalls({ delayMs: 0 });
      if (retried.emailed !== 1 || sent.length !== 1 || sent[0].cars.length !== 2) {
        throw new Error('group was not retried after acknowledgement failure');
      }
      await Promise.all(cars.map(car => car.reload()));
      if (cars[0].recalls_seen.join() !== '20V001,26V201' || cars[1].recalls_seen.join() !== '20V002,26V202' ||
          cars.some(car => car.recalls_checked_at <= checkedBefore)) {
        throw new Error('retry acknowledgement was not saved');
      }
    } finally {
      db.user_car.removeHook('beforeUpdate', 'recall-acknowledgement-failure');
    }
  });

  it('turns alerts off from the email link, signed out, and refuses a forged one', async function() {
    await request(app).get(`/auth/recall-alerts/off?u=${owner.id}&t=${'0'.repeat(64)}`).expect(404);
    await owner.reload();
    if (!owner.recallAlerts) throw new Error('forged link turned alerts off');
    const link = new URL(unsubscribeUrl(owner.id));
    await request(app).get(link.pathname + link.search).expect(302);
    await owner.reload();
    if (owner.recallAlerts) throw new Error('alerts still on');
  });
});
