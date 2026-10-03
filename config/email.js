const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const FROM     = process.env.EMAIL_FROM || 'AutoDex <noreply@autodx.io>';

// User-supplied values (name) are interpolated into HTML — escape them so a
// display name like `<img onerror=…>` can't inject markup into the email.
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendVerificationEmail(toEmail, toName, token) {
  // Never hit the Resend API (or spend quota) from the test suite
  if (process.env.NODE_ENV === 'test') {
    console.log(`[test] Skipping verification email to ${toEmail}`);
    return;
  }
  const link = `${BASE_URL}/auth/verify/${encodeURIComponent(token)}`;
  const safeName = escapeHtml(toName);
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Verify your AutoDex account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
        <h2 style="margin-bottom:0.5rem;">Welcome to AutoDex, ${safeName}!</h2>
        <p style="color:#71717a;">Click the button below to verify your email address and activate your account.</p>
        <a href="${link}" style="display:inline-block;margin:1.5rem 0;padding:0.75rem 1.75rem;background:#ed5353;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;">
          Verify Email
        </a>
        <p style="color:#71717a;font-size:0.8rem;">Or copy this link: ${link}</p>
        <p style="color:#71717a;font-size:0.8rem;">This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>
      </div>
    `
  });
}

async function sendPasswordResetEmail(toEmail, toName, token) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`[test] Skipping password reset email to ${toEmail}`);
    return;
  }
  const link = `${BASE_URL}/auth/reset/${encodeURIComponent(token)}`;
  const safeName = escapeHtml(toName);
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Reset your AutoDex password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
        <h2 style="margin-bottom:0.5rem;">Hi ${safeName},</h2>
        <p style="color:#71717a;">Someone (hopefully you) asked to reset your AutoDex password. Click below to choose a new one.</p>
        <a href="${link}" style="display:inline-block;margin:1.5rem 0;padding:0.75rem 1.75rem;background:#ed5353;color:#fff;text-decoration:none;border-radius:4px;font-weight:600;">
          Reset Password
        </a>
        <p style="color:#71717a;font-size:0.8rem;">Or copy this link: ${link}</p>
        <p style="color:#71717a;font-size:0.8rem;">This link expires in 1 hour and works once. If you didn't ask for this, ignore this email. Your password won't change.</p>
      </div>
    `
  });
}

// New recalls for a user's garage cars: [{ car: 'Year Make Model', carUrl,
// recalls: [{ campaign, component, summary }] }]. NHTSA text is escaped too.
async function sendRecallAlertEmail(toEmail, toName, cars, unsubscribeUrl) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`[test] Skipping recall alert email to ${toEmail}`);
    return;
  }
  const count = cars.reduce((n, c) => n + c.recalls.length, 0);
  const items = cars.map(c => `
        <h3 style="margin:1.5rem 0 0.5rem;"><a href="${BASE_URL}${c.carUrl}" style="color:#ed5353;">${escapeHtml(c.car)}</a></h3>
        ${c.recalls.map(r => `
        <p style="margin:0 0 0.25rem;font-weight:600;">${escapeHtml(r.component)} <span style="color:#71717a;font-weight:400;">(NHTSA ${escapeHtml(r.campaign)})</span></p>
        <p style="color:#71717a;margin:0 0 1rem;">${escapeHtml(r.summary)}</p>`).join('')}`).join('');
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: count === 1 ? 'A new recall for a car in your AutoDex garage' : `${count} new recalls for cars in your AutoDex garage`,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
        <h2 style="margin-bottom:0.5rem;">Hi ${escapeHtml(toName)},</h2>
        <p style="color:#71717a;">NHTSA has posted ${count === 1 ? 'a new recall' : 'new recalls'} for ${cars.length === 1 ? 'a car' : 'cars'} in your garage. Your dealer fixes recalls for free.</p>
        ${items}
        <p style="color:#71717a;font-size:0.8rem;margin-top:2rem;">You get these because recall alerts are on in your garage settings. <a href="${unsubscribeUrl}" style="color:#71717a;">Turn off recall alerts</a></p>
      </div>
    `
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendRecallAlertEmail };
