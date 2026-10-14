// Recall alerts (R5), daily. For owners who turned alerts on, look up each
// garage car's NHTSA recalls once a week and email the owner the campaigns
// that weren't there last time. A car's first check only records what's
// already out (its garage page lists those). A failed lookup is retried the
// next day. New campaigns are acknowledged only after the alert is accepted.
const db = require('../models');
const nhtsa = require('../lib/nhtsa'); // via the module so tests can stub getRecalls
const email = require('../config/email'); // likewise sendRecallAlertEmail
const { recallUnsubscribeToken } = require('../lib/tokens');

const RECHECK_DAYS = 7;
const BATCH = 300; // cars per run; NHTSA answers are cached 12h
const DELAY_MS = 250;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function unsubscribeUrl(userId) {
  return `${BASE_URL}/auth/recall-alerts/off?u=${userId}&t=${recallUnsubscribeToken(userId)}`;
}

async function checkRecalls({ batch = BATCH, delayMs = DELAY_MS } = {}) {
  const { Op } = db.Sequelize;
  const due = new Date(Date.now() - RECHECK_DAYS * 24 * 60 * 60 * 1000);
  const cars = await db.user_car.findAll({
    where: { [Op.or]: [{ recalls_checked_at: null }, { recalls_checked_at: { [Op.lt]: due } }] },
    include: [{ model: db.user, where: { recallAlerts: true, emailVerified: true }, attributes: ['id', 'name', 'email'] }],
    order: [['recalls_checked_at', 'ASC NULLS FIRST'], ['id', 'ASC']],
    limit: batch
  });

  const news = new Map(); // userId → { user, cars: [...], pending: [...] }
  for (const car of cars) {
    const year = parseInt(car.year, 10);
    try {
      const recalls = year ? await nhtsa.getRecalls(car.make, car.model, year) : [];
      const seen = car.recalls_seen;
      const fresh = seen ? recalls.filter(r => r.campaign && !seen.includes(r.campaign)) : [];
      const campaigns = [...new Set([...(seen || []), ...recalls.map(r => r.campaign).filter(Boolean)])];
      if (fresh.length) {
        if (!news.has(car.user.id)) news.set(car.user.id, { user: car.user, cars: [], pending: [] });
        const group = news.get(car.user.id);
        group.cars.push({
          car: `${car.year} ${car.make} ${car.model}`,
          carUrl: `/garage/car/${car.id}`,
          recalls: fresh.map(r => ({ campaign: r.campaign, component: r.component, summary: r.summary }))
        });
        group.pending.push({ car, campaigns });
      } else {
        // First-check baseline, or no new campaigns: no email is required.
        await car.update({ recalls_seen: campaigns, recalls_checked_at: new Date() });
      }
    } catch (err) {
      console.log(`Recall check error for garage car ${car.id} (retried tomorrow):`, err.message);
    }
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }

  let emailed = 0;
  for (const { user, cars: list, pending } of news.values()) {
    try {
      await email.sendRecallAlertEmail(user.email, user.name, list, unsubscribeUrl(user.id));
      emailed++;
    } catch (err) {
      console.log(`Recall alert email error for user ${user.id} (retried tomorrow):`, err.message);
      continue;
    }
    try {
      // Keep every car in the grouped email pending until the provider accepts it.
      // A DB failure after acceptance can resend the alert on the next run.
      await db.sequelize.transaction(async (transaction) => {
        for (const { car, campaigns } of pending) {
          await car.update({ recalls_seen: campaigns, recalls_checked_at: new Date() }, { transaction });
        }
      });
    } catch (err) {
      console.log(`Recall alert acknowledgement error for user ${user.id} (may be sent again):`, err.message);
    }
  }
  if (cars.length) console.log(`Recall alerts: ${cars.length} garage cars checked, ${emailed} owners emailed`);
  return { checked: cars.length, emailed };
}

module.exports = { checkRecalls, unsubscribeUrl, RECHECK_DAYS };
