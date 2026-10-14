const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const emailPath = path.join(__dirname, '../config/email.js');
const emailSource = readFileSync(emailPath, 'utf8');
const recipient = 'alex@example.com';
const displayName = '<Alex & "Rae">';
const safeName = '&lt;Alex &amp; &quot;Rae&quot;&gt;';
const token = 'token/+?';
const unsubscribeUrl = 'https://autodex.example/auth/recall-alerts/off?u=1&t=signed';

// Load the real module in a fresh sandbox so production/test behavior can be
// exercised without changing process.env or an already imported SDK instance.
function loadEmail(deliver = async () => ({ data: { id: 'email-id' }, error: null }), env = {}) {
  const calls = [];
  const loaded = { exports: {} };
  vm.runInNewContext(emailSource, {
    module: loaded,
    process: { env: {
      NODE_ENV: 'production',
      RESEND_API_KEY: 'isolated-test-key',
      BASE_URL: 'https://autodex.example',
      EMAIL_FROM: 'AutoDex Tests <noreply@example.com>',
      ...env
    } },
    console: { log() {} },
    require(name) {
      assert.equal(name, 'resend');
      return { Resend: class {
        constructor(apiKey) {
          assert.equal(apiKey, 'isolated-test-key');
          this.emails = { send: async payload => {
            calls.push(payload);
            return deliver(payload);
          } };
        }
      } };
    }
  }, { filename: emailPath });
  return { email: loaded.exports, calls };
}

const cases = [
  {
    name: 'verification',
    send: email => email.sendVerificationEmail(recipient, displayName, token),
    subject: 'Verify your AutoDex account',
    check(payload) {
      assert.ok(payload.html.includes(`https://autodex.example/auth/verify/${encodeURIComponent(token)}`));
    }
  },
  {
    name: 'password reset',
    send: email => email.sendPasswordResetEmail(recipient, displayName, token),
    subject: 'Reset your AutoDex password',
    check(payload) {
      assert.ok(payload.html.includes(`https://autodex.example/auth/reset/${encodeURIComponent(token)}`));
    }
  },
  {
    name: 'recall alert',
    send: email => email.sendRecallAlertEmail(recipient, displayName, [{
      car: '2026 Test <Car>',
      carUrl: '/cars/test-car',
      recalls: [{ campaign: '26V001', component: 'Steering & brakes', summary: '<Unsafe>' }]
    }], unsubscribeUrl),
    subject: 'A new recall for a car in your AutoDex garage',
    check(payload) {
      assert.equal(payload.headers['List-Unsubscribe'], `<${unsubscribeUrl}>`);
      assert.ok(payload.html.includes('https://autodex.example/cars/test-car'));
      assert.ok(payload.html.includes('2026 Test &lt;Car&gt;'));
      assert.ok(payload.html.includes('Steering &amp; brakes'));
      assert.ok(payload.html.includes('&lt;Unsafe&gt;'));
    }
  }
];

describe('Email delivery', function() {
  for (const entry of cases) {
    describe(entry.name, function() {
      it('resolves after provider acceptance with the expected payload', async function() {
        const { email, calls } = loadEmail();
        await entry.send(email);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].from, 'AutoDex Tests <noreply@example.com>');
        assert.equal(calls[0].to, recipient);
        assert.equal(calls[0].subject, entry.subject);
        assert.ok(calls[0].html.includes(safeName));
        assert.ok(!calls[0].html.includes(displayName));
        entry.check(calls[0]);
      });

      it('rejects a provider error result with its message', async function() {
        const { email, calls } = loadEmail(async () => ({
          data: null,
          error: { name: 'validation_error', message: 'Provider refused email' }
        }));
        await assert.rejects(() => entry.send(email), /Provider refused email/);
        assert.equal(calls.length, 1);
      });

      it('propagates a thrown transport failure', async function() {
        const failure = new Error('Transport unavailable');
        const { email, calls } = loadEmail(async () => { throw failure; });
        await assert.rejects(() => entry.send(email), error => error === failure);
        assert.equal(calls.length, 1);
      });

      it('does not call the provider in test mode', async function() {
        const { email, calls } = loadEmail(async () => {
          throw new Error('Provider must not run in test mode');
        }, { NODE_ENV: 'test' });
        await entry.send(email);
        assert.equal(calls.length, 0);
      });
    });
  }
});
