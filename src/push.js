const webpush = require('web-push');
const db = require('./db');
const { ALL_PREFS } = require('./stations');
const { flattenChanges, filterForPrefs, buildPushPayload } = require('./changes');
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

// Sends one payload per stored subscription, built by `payloadFor(sub)`
// (return null to skip that subscriber). Prunes subscriptions the push service
// reports as gone (410/404).
async function sendToAll(payloadFor) {
  if (!enabled) return { sent: 0, pruned: 0, skipped: 0 };
  const subs = await db.getPushSubscriptions();
  const build = typeof payloadFor === 'function' ? payloadFor : () => payloadFor;
  let sent = 0;
  let pruned = 0;
  let skipped = 0;

  for (const sub of subs) {
    const payload = build(sub);
    if (!payload) { skipped++; continue; }
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 6 * 3600 });
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
  return { sent, pruned, skipped };
}

// Per-subscriber payload: only the station/fuel changes they asked for.
function payloadForSubscriber(changes, sub, latest = {}) {
  const prefs = { stations: sub.stations || ALL_PREFS.stations, fuels: sub.fuels || ALL_PREFS.fuels };
  const items = filterForPrefs(flattenChanges(changes), prefs);
  if (!items.length) return null;
  return buildPushPayload(items, latest, prefs);
}

// Backwards-compatible helper: payload for someone following everything.
function buildChangePayload(changes, latest = {}) {
  return payloadForSubscriber(changes, ALL_PREFS, latest);
}

async function sendPriceChangePush(changes, { latest = {} } = {}) {
  return sendToAll((sub) => payloadForSubscriber(changes, sub, latest));
}

module.exports = {
  getPublicKey, sendToAll, sendPriceChangePush, buildChangePayload, payloadForSubscriber, isValidPushEndpoint,
};
