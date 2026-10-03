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
