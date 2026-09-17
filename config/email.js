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

module.exports = { sendVerificationEmail };
