const express = require('express');
const path = require('path');
const db = require('./db');
const { computeLastMove, computeLastMoveByFuel, markGaps } = require('./leaderboard');
const { startCron } = require('./cron');
const push = require('./push');
const { STATIONS, stationBySlug, normalizePrefs, ALL_PREFS } = require('./stations');
require('dotenv').config();

const app = express();
// Behind nginx: take the client IP from X-Forwarded-For so rate limiting
// works per user instead of lumping everyone under the proxy's IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '4kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, file) {
    // HTML + service worker must revalidate so new deploys reach clients.
    if (/manage\.html$/.test(file)) res.setHeader('Cache-Control', 'no-store');
    else if (/\.(html|webmanifest)$|sw\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Token-bearing pages and endpoints must never be stored by browsers, proxies or the SW.
function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}
app.use(['/unsubscribe', '/api/subscription', '/api/unsubscribe', '/api/push'], noStore);

// Minimal in-memory rate limiter for the public write endpoints.
const rateBuckets = new Map();
function rateLimit(maxPerMinute) {
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || [];
    const recent = bucket.filter((t) => now - t < 60_000);
    if (recent.length >= maxPerMinute) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    if (rateBuckets.size > 10_000) rateBuckets.clear(); // memory backstop
    next();
  };
}

function prefsFrom(body) {
  // Missing prefs => everything (old clients); present-but-invalid => 400.
  if (!body || body.fuels === undefined) return ALL_PREFS;
  return normalizePrefs(body);
}

// Pure: dashboard payload for one station from its recent (ascending) rows.
function stationSummary(cfg, recent) {
  if (!recent.length) {
    return { slug: cfg.slug, name: cfg.name, location: cfg.location, label: cfg.label, short: cfg.short, available: false };
  }
  const last = recent[recent.length - 1];
  return {
    slug: cfg.slug, name: cfg.name, location: cfg.location, label: cfg.label, short: cfg.short,
    available: true,
    natural95: parseFloat(last.natural95),
    diesel: parseFloat(last.diesel),
    checked_at: last.checked_at,
    lastMove: computeLastMove(recent),
    lastMoveByFuel: computeLastMoveByFuel(recent),
  };
}

app.get('/api/stations/latest', async (req, res) => {
  try {
    const out = [];
    for (const cfg of STATIONS) {
      const st = await db.getStationBySlug(cfg.slug);
      const recent = st ? await db.getRecentForStation(st.id, 500) : [];
      out.push(stationSummary(cfg, recent));
    }
    res.set('Cache-Control', 'no-store');
    res.json({ stations: out, now: new Date() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/history', async (req, res) => {
  const days = req.query.days === 'all' ? 36500 : Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 730));
  try {
    if (req.query.station === 'all') {
      const out = {};
      for (const cfg of STATIONS) {
        const st = await db.getStationBySlug(cfg.slug);
        out[cfg.slug] = st ? markGaps(await db.getHistoryForStation(st.id, days)) : [];
      }
      res.set('Cache-Control', 'no-store');
      return res.json(out);
    }
    const slug = stationBySlug(req.query.station) ? req.query.station : 'tank-ono';
    const station = await db.getStationBySlug(slug);
    if (!station) return res.json([]);
    res.json(markGaps(await db.getHistoryForStation(station.id, days)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ── E-mail subscriptions ──

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/subscribe', rateLimit(5), async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Neplatný e-mail' });
  const prefs = prefsFrom(req.body);
  if (!prefs) return res.status(400).json({ error: 'Vyber aspoň jedno palivo' });
  try {
    // Existing addresses keep their settings (changeable only via the e-mailed link),
    // so nobody can rewrite someone else's preferences by knowing their address.
    // The response is identical either way — no e-mail enumeration.
    await db.addSubscriber(email, prefs);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/subscription', rateLimit(30), async (req, res) => {
  try {
    const sub = await db.getSubscriberByToken(req.query.token);
    if (!sub) return res.status(404).json({ error: 'Odběr nenalezen' });
    res.json({ email: sub.email, fuels: sub.fuels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/subscription', rateLimit(10), async (req, res) => {
  const prefs = normalizePrefs(req.body || {});
  if (!prefs) return res.status(400).json({ error: 'Vyber aspoň jedno palivo' });
  try {
    const ok = await db.getSubscriberByToken(req.body.token) && await db.updateSubscriberPrefs(req.body.token, prefs);
    if (!ok) return res.status(404).json({ error: 'Odběr nenalezen' });
    res.json({ ok: true, fuels: prefs.fuels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/unsubscribe', rateLimit(10), async (req, res) => {
  try {
    const sub = await db.getSubscriberByToken(req.body && req.body.token);
    if (!sub) return res.status(404).json({ error: 'Odběr nenalezen' });
    await db.removeSubscriberByToken(sub.token);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${title} · Dejnyho Hlídač</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;800&display=swap" rel="stylesheet">
<style>:root{color-scheme:light;--bg:#fff;--ink:#0a0a0a;--muted:#6e6e6e}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0b0b0b;--ink:#f2f2f2;--muted:#8c8c8c}}
body{margin:0;background:var(--bg);color:var(--ink);font:500 16px/1.55 Archivo,'Helvetica Neue',Arial,sans-serif}
main{max-width:30rem;margin:14vh auto;padding:0 16px}
h1{font-weight:800;font-size:2rem;line-height:1.1;letter-spacing:-.02em;margin:0 0 .6rem;border-top:2px solid var(--ink);padding-top:.6rem}
p{color:var(--muted);margin:0 0 1.2rem}a{color:inherit;text-underline-offset:3px}
button,a.b{font:800 15px Archivo,'Helvetica Neue',Arial,sans-serif;padding:.7rem 1.25rem;border-radius:4px;border:1px solid var(--ink);background:var(--ink);color:var(--bg);cursor:pointer;text-decoration:none;display:inline-block}
form{margin:0 0 1.2rem}</style>
</head><body><main>${bodyHtml}</main></body></html>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LEGACY_MSG = '<h1>Tenhle odkaz už neplatí</h1><p>Odhlásit se nebo upravit odběr můžeš odkazem v nejnovějším e-mailu od Hlídače.</p><a class="b" href="/">Zpět na přehled</a>';

// GET only shows a confirmation (mail scanners pre-fetch links); POST unsubscribes.
// POST also serves RFC 8058 one-click (List-Unsubscribe-Post) from mail clients.
app.get('/unsubscribe', (req, res) => {
  const { token } = req.query;
  // Old e-mails linked /unsubscribe?email=… — that is not proof of ownership,
  // so it never deletes anything; the newest e-mail carries a tokenised link.
  if (!token) return res.status(400).send(page('Použij nový odkaz', LEGACY_MSG));
  const field = `<input type="hidden" name="token" value="${escapeAttr(token)}">`;
  res.send(page('Odhlásit odběr', `<h1>Odhlásit upozornění?</h1><p>Přestanou chodit e-maily o změnách cen.</p>
<form method="post" action="/unsubscribe">${field}<button type="submit">Odhlásit</button></form>
<p><a href="/manage.html?token=${encodeURIComponent(token)}">Jen upravit paliva</a></p>`));
});

app.post('/unsubscribe', rateLimit(10), async (req, res) => {
  const token = (req.body && req.body.token) || req.query.token;
  try {
    if (!token) return res.status(400).send(page('Použij nový odkaz', LEGACY_MSG));
    const sub = await db.getSubscriberByToken(token);
    if (sub) await db.removeSubscriberByToken(sub.token);
    res.send(page('Odhlášeno', '<h1>Odhlášeno</h1><p>Další e-maily o změnách cen už nepřijdou.</p><a class="b" href="/">Zpět na přehled</a>'));
  } catch (err) {
    console.error(err);
    res.status(500).send(page('Chyba', '<h1>Odhlášení se nepovedlo</h1><p>Zkus to znovu.</p>'));
  }
});

// ── Web Push ──

app.get('/api/push/public-key', (req, res) => {
  const key = push.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ key });
});

app.post('/api/push/subscribe', rateLimit(10), async (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  if (!push.isValidPushEndpoint(sub.endpoint) ||
      String(sub.keys.p256dh).length > 255 || String(sub.keys.auth).length > 255) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  const prefs = prefsFrom(req.body);
  if (!prefs) return res.status(400).json({ error: 'Vyber aspoň jedno palivo' });
  try {
    await db.addPushSubscription({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs);
    res.json({ ok: true, fuels: prefs.fuels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

// The endpoint URL is an unguessable capability held only by that browser.
app.post('/api/push/status', rateLimit(30), async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!push.isValidPushEndpoint(endpoint)) return res.status(400).json({ error: 'Invalid endpoint' });
  try {
    const sub = await db.getPushSubscription(endpoint);
    res.json(sub ? { subscribed: true, fuels: sub.fuels } : { subscribed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/push/prefs', rateLimit(10), async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!push.isValidPushEndpoint(endpoint)) return res.status(400).json({ error: 'Invalid endpoint' });
  const prefs = normalizePrefs(req.body);
  if (!prefs) return res.status(400).json({ error: 'Vyber aspoň jedno palivo' });
  try {
    const ok = await db.updatePushPrefs(endpoint, prefs);
    if (!ok) return res.status(404).json({ error: 'Subscription not found' });
    res.json({ ok: true, fuels: prefs.fuels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/push/unsubscribe', rateLimit(10), async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint || typeof endpoint !== 'string') return res.status(400).json({ error: 'Missing endpoint' });
  try {
    await db.removePushSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
    startCron();
  });
}

module.exports = { app, stationSummary, prefsFrom };
