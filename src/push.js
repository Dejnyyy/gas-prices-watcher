const webpush = require('web-push');
const db = require('./db');
require('dotenv').config();

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:hlidac@dejny.eu';

const enabled = Boolean(publicKey && privateKey);
if (enabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.warn('VAPID keys not set — push notifications disabled.');
}

function getPublicKey() {
  return enabled ? publicKey : null;
}

// SSRF guard: web-push POSTs to this URL from the server, so only accept
// endpoints hosted by the browsers' real push services (hostname allowlist —
// a plain "public hostname" check is bypassable via attacker-controlled DNS).
const PUSH_HOST_ALLOWLIST = [
  /^fcm\.googleapis\.com$/,                      // Chrome / Chromium
  /^updates\.push\.services\.mozilla\.com$/,     // Firefox
  /(^|\.)push\.services\.mozilla\.com$/,         // Firefox (regional)
  /(^|\.)push\.apple\.com$/,                     // Safari / iOS
  /(^|\.)notify\.windows\.com$/,                 // Edge (WNS)
];

function isValidPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 500) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_ALLOWLIST.some((re) => re.test(host));
}

// Sends payload to every stored subscription; prunes subscriptions the
// push service reports as gone (410/404).
async function sendToAll(payload) {
  if (!enabled) return { sent: 0, pruned: 0 };
  const subs = await db.getPushSubscriptions();
  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, body);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.removePushSubscription(sub.endpoint);
        pruned++;
      } else {
        console.error('Push send failed:', err.statusCode || err.message);
      }
    }
  }
  return { sent, pruned };
}

function fuelDelta(oldV, newV) {
  return Math.round((newV - oldV) * 100) / 100;
}

// Builds a compact notification for a set of price changes.
function buildChangePayload(changes) {
  const lines = changes.map((c) => {
    const parts = [];
    const dn = fuelDelta(c.old.natural95, c.new.natural95);
    const dd = fuelDelta(c.old.diesel, c.new.diesel);
    if (dn !== 0) {
      parts.push('Natural ' + (dn > 0 ? '↑' : '↓') + ' ' + c.new.natural95.toFixed(2).replace('.', ',') + ' Kč');
    }
    if (dd !== 0) {
      parts.push('Diesel ' + (dd > 0 ? '↑' : '↓') + ' ' + c.new.diesel.toFixed(2).replace('.', ',') + ' Kč');
    }
    return c.name + ': ' + (parts.length ? parts.join(', ') : 'beze změny');
  });
  return {
    title: 'Dejnyho Hlídač — změna cen',
    body: lines.join('\n'),
    url: '/',
  };
}

async function sendPriceChangePush(changes) {
  return sendToAll(buildChangePayload(changes));
}

module.exports = { getPublicKey, sendToAll, sendPriceChangePush, buildChangePayload, isValidPushEndpoint };
