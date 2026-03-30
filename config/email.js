const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const FROM     = process.env.EMAIL_FROM || 'AutoDex <noreply@autodx.io>';

async function sendVerificationEmail(toEmail, toName, token) {
  const link = `${BASE_URL}/auth/verify/${token}`;
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Verify your AutoDex account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
        <h2 style="margin-bottom:0.5rem;">Welcome to AutoDex, ${toName}!</h2>
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
