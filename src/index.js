const express = require('express');
const path = require('path');
const db = require('./db');
const { computeLastMove, rankStations } = require('./leaderboard');
const { startCron } = require('./cron');
const push = require('./push');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Pure: assemble ranked leaderboard payload from per-station latest+lastMove objects.
function buildLeaderboard(stations) {
  // Rank every station so ranks are correct even outside the top 10.
  const fullRanked = rankStations(stations, stations.length);
  const top = fullRanked.slice(0, 10);
  const primary = fullRanked.find((s) => s.is_primary) || null;
  // Spec: the primary (Tank ONO) is always shown, even if it isn't among the 10 cheapest.
  const display =
    primary && !top.some((s) => s.slug === primary.slug) ? [...top, primary] : top;
  return { primary, stations: display };
}

app.get('/api/stations/latest', async (req, res) => {
  try {
    const stationRows = await db.getStations();
    const enriched = [];
    for (const st of stationRows) {
      const recent = await db.getRecentForStation(st.id, 60);
      if (!recent.length) continue;
      const latest = recent[recent.length - 1];
      enriched.push({
        slug: st.slug, name: st.name, is_primary: st.is_primary,
        natural95: parseFloat(latest.natural95), diesel: parseFloat(latest.diesel),
        lastMove: computeLastMove(recent),
        checked_at: latest.checked_at,
      });
    }
    res.json(buildLeaderboard(enriched));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/history', async (req, res) => {
  const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 365));
  const slug = req.query.station || 'tank-ono';
  try {
    const station = await db.getStationBySlug(slug);
    if (!station) return res.json([]);
    const rows = await db.getHistoryForStation(station.id, days);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/subscribe', rateLimit(5), async (req, res) => {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });
  try {
    await db.addSubscriber(email);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

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
  try {
    await db.addPushSubscription({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/push/unsubscribe', rateLimit(10), async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  try {
    await db.removePushSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/unsubscribe', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).send('Missing email parameter.');
  try {
    await db.removeSubscriber(decodeURIComponent(email));
    res.send(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:400px;margin:80px auto;text-align:center">' +
      '<h2>Odhlaseni uspesne</h2><p>Vas email byl uspesne odebran ze seznamu odberat.</p></body></html>'
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Chyba pri odhlaseni.');
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
    startCron();
  });
}

module.exports = { app, buildLeaderboard };
