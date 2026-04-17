const express = require('express');
const path = require('path');
const db = require('./db');
const { startCron } = require('./cron');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/latest', async (req, res) => {
  try {
    const latest = await db.getLatest();
    res.json(latest || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/history', async (req, res) => {
  const days = parseInt(req.query.days, 10) || 30;
  try {
    const rows = await db.getHistory(days);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  try {
    await db.addSubscriber(email);
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
      '<h2>Odhlaseni uspesne</h2>' +
      '<p>Vas email byl odebran ze seznamu odbератели.</p>' +
      '</body></html>'
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Chyba pri odhlaseni.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  startCron();
});
