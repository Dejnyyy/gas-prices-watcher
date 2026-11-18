// Sends ONE sample price-change e-mail (fake data) to NOTIFY_EMAIL only —
// never to subscribers. Usage: node scripts/send-test-email.js [--dry]
require('dotenv').config();
const fs = require('fs');
const { buildMessage, resend } = require('../src/notifier');

const changes = [
  { slug: 'tank-ono', name: 'Tank ONO', old: { natural95: 38.5, diesel: 42.9 }, new: { natural95: 37.9, diesel: 43.2 } },
];
const latest = { 'tank-ono': { natural95: 37.9, diesel: 43.2 } };

(async () => {
  const to = process.env.NOTIFY_EMAIL;
  const baseUrl = process.env.BASE_URL || 'https://beno.dejny.eu';
  if (!to) throw new Error('NOTIFY_EMAIL not set');
  const msg = buildMessage(changes, { email: to, token: null }, { baseUrl, latest });
  msg.subject = '[TEST] ' + msg.subject;
  if (process.argv.includes('--dry')) {
    fs.writeFileSync('test-email.html', msg.html);
    console.log('Subject:', msg.subject, '\nWrote test-email.html');
    return;
  }
  const res = await resend.emails.send(msg);
  if (res.error) throw new Error(JSON.stringify(res.error));
  console.log('Sent test e-mail to', to, '—', msg.subject, res.data && res.data.id);
})().catch((e) => { console.error(e.message); process.exit(1); });
