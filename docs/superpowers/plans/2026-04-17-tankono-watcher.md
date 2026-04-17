# Tank ONO Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Node.js server that scrapes Tank ONO fuel prices every 5 minutes, stores history in MySQL, emails all subscribers on price change, and serves a web dashboard.

**Architecture:** Express server with a node-cron job that runs a cheerio scraper, compares results to the last DB record, and triggers Resend emails to all subscribers if any price changed. Static web UI (vanilla JS + Chart.js) is served from `public/` and fetches data from the same server's REST API.

**Tech Stack:** Node.js, Express, node-cron, axios, cheerio, mysql2, Resend, Chart.js (CDN), pm2 for deployment.

---

## File Map

| File | Responsibility |
|---|---|
| `src/db.js` | MySQL connection pool + all DB queries |
| `src/scraper.js` | Fetch + parse Tank ONO price page |
| `src/notifier.js` | Send price-change email to all subscribers via Resend |
| `src/cron.js` | Schedule 5-minute check: scrape → compare → save → notify |
| `src/index.js` | Express app: API routes + serve `public/` |
| `public/index.html` | Web dashboard markup |
| `public/style.css` | Dashboard styles |
| `public/app.js` | Fetch API data, render Chart.js + table + subscribe form |
| `package.json` | Dependencies |
| `.env.example` | Config template |

---

## Task 1: Project scaffold + dependencies

**Files:**
- Create: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Initialise project**

```bash
cd /Users/dejny/Webs/tankono-watcher
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install express axios cheerio mysql2 node-cron resend dotenv
npm install --save-dev jest
```

- [ ] **Step 3: Update package.json scripts**

Edit `package.json` so `scripts` contains:

```json
"scripts": {
  "start": "node src/index.js",
  "dev": "node --watch src/index.js",
  "test": "jest"
}
```

- [ ] **Step 4: Create `.env.example`**

```
PORT=3000
DB_HOST=db.bagros.eu
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=tankono
RESEND_API_KEY=re_xxxxxxxxxxxx
NOTIFY_EMAIL=you@example.com
BASE_URL=https://tankono.bagros.eu
```

- [ ] **Step 5: Create your own `.env`** (never commit this)

Copy `.env.example` to `.env` and fill in real values.

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 7: Commit**

```bash
git init
git add package.json package-lock.json .env.example .gitignore
git commit -m "feat: project scaffold and dependencies"
```

---

## Task 2: Database module + schema

**Files:**
- Create: `src/db.js`
- Create: `tests/db.test.js`

- [ ] **Step 1: Create the MySQL tables**

Connect to your MySQL server at `db.bagros.eu` and run:

```sql
CREATE DATABASE IF NOT EXISTS tankono;
USE tankono;

CREATE TABLE IF NOT EXISTS price_checks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  checked_at DATETIME NOT NULL,
  natural95 DECIMAL(5,2) NOT NULL,
  diesel DECIMAL(5,2) NOT NULL,
  lpg DECIMAL(5,2) NOT NULL,
  changed TINYINT(1) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: Write `src/db.js`**

```js
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
});

async function saveCheck(prices, changed) {
  await pool.execute(
    'INSERT INTO price_checks (checked_at, natural95, diesel, lpg, changed) VALUES (NOW(), ?, ?, ?, ?)',
    [prices.natural95, prices.diesel, prices.lpg, changed ? 1 : 0]
  );
}

async function getLatest() {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks ORDER BY checked_at DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function getHistory(days = 30) {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks WHERE changed = 1 AND checked_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY checked_at ASC',
    [days]
  );
  return rows;
}

async function addSubscriber(email) {
  await pool.execute(
    'INSERT IGNORE INTO subscribers (email) VALUES (?)',
    [email]
  );
}

async function removeSubscriber(email) {
  await pool.execute('DELETE FROM subscribers WHERE email = ?', [email]);
}

async function getSubscribers() {
  const [rows] = await pool.execute('SELECT email FROM subscribers');
  return rows.map((r) => r.email);
}

module.exports = { saveCheck, getLatest, getHistory, addSubscriber, removeSubscriber, getSubscribers };
```

- [ ] **Step 3: Write failing tests for `src/db.js`**

Create `tests/db.test.js`:

```js
// Integration tests — require a real DB connection.
// Set DB_NAME to a test database (e.g. tankono_test) in .env before running.
const db = require('../src/db');

beforeAll(async () => {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await conn.execute('DELETE FROM price_checks');
  await conn.execute('DELETE FROM subscribers');
  await conn.end();
});

test('saveCheck and getLatest round-trip', async () => {
  const prices = { natural95: 36.10, diesel: 34.50, lpg: 18.20 };
  await db.saveCheck(prices, true);
  const latest = await db.getLatest();
  expect(parseFloat(latest.natural95)).toBeCloseTo(36.10);
  expect(parseFloat(latest.diesel)).toBeCloseTo(34.50);
  expect(parseFloat(latest.lpg)).toBeCloseTo(18.20);
  expect(latest.changed).toBe(1);
});

test('getHistory returns only changed rows', async () => {
  await db.saveCheck({ natural95: 36.10, diesel: 34.50, lpg: 18.20 }, false);
  const history = await db.getHistory(1);
  expect(history.every((r) => r.changed === 1)).toBe(true);
});

test('addSubscriber and getSubscribers', async () => {
  await db.addSubscriber('test@example.com');
  const subs = await db.getSubscribers();
  expect(subs).toContain('test@example.com');
});

test('addSubscriber ignores duplicate email', async () => {
  await db.addSubscriber('test@example.com');
  const subs = await db.getSubscribers();
  expect(subs.filter((e) => e === 'test@example.com').length).toBe(1);
});

test('removeSubscriber deletes by email', async () => {
  await db.removeSubscriber('test@example.com');
  const subs = await db.getSubscribers();
  expect(subs).not.toContain('test@example.com');
});
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/db.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: database module with price_checks and subscribers"
```

---

## Task 3: Scraper module

**Files:**
- Create: `src/scraper.js`
- Create: `tests/scraper.test.js`
- Create: `tests/fixtures/cenik.html`

- [ ] **Step 1: Inspect the Tank ONO page structure**

Open `https://www.tank-ono.cz/cz/index.php?page=cenik` in a browser. Find the HTML elements that contain the Natural 95, Diesel, and LPG prices. Note the selectors (table rows, class names).

- [ ] **Step 2: Save a fixture of the real page**

```bash
node -e "require('axios').get('https://www.tank-ono.cz/cz/index.php?page=cenik').then(r => require('fs').writeFileSync('tests/fixtures/cenik.html', r.data))"
```

Then trim `tests/fixtures/cenik.html` to just the relevant table section (keep it small — a few KB).

- [ ] **Step 3: Write failing test**

Create `tests/scraper.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { parsePrices } = require('../src/scraper');

test('parsePrices extracts Natural 95, Diesel and LPG from fixture HTML', () => {
  const html = fs.readFileSync(
    path.join(__dirname, 'fixtures/cenik.html'),
    'utf8'
  );
  const prices = parsePrices(html);
  expect(typeof prices.natural95).toBe('number');
  expect(typeof prices.diesel).toBe('number');
  expect(typeof prices.lpg).toBe('number');
  expect(prices.natural95).toBeGreaterThan(20);
  expect(prices.diesel).toBeGreaterThan(20);
  expect(prices.lpg).toBeGreaterThan(10);
});

test('parsePrices returns null when HTML structure is unexpected', () => {
  const prices = parsePrices('<html><body>no prices here</body></html>');
  expect(prices).toBeNull();
});
```

- [ ] **Step 4: Run test to confirm it fails**

```bash
npm test tests/scraper.test.js
```

Expected: FAIL — `parsePrices` not yet defined.

- [ ] **Step 5: Write `src/scraper.js`**

Adjust the cheerio selectors to match the actual HTML you saw in Step 1:

```js
const axios = require('axios');
const cheerio = require('cheerio');

const URL = 'https://www.tank-ono.cz/cz/index.php?page=cenik';

function parsePrices(html) {
  try {
    const $ = cheerio.load(html);
    const prices = {};

    // Adjust selectors to match the live page after inspecting it in Step 1.
    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;
      const label = $(cells[0]).text().trim().toLowerCase();
      const rawPrice = $(cells[1]).text().trim().replace(',', '.').replace(/[^\d.]/g, '');
      const price = parseFloat(rawPrice);
      if (isNaN(price)) return;

      if (label.includes('natural') || label.includes('95')) prices.natural95 = price;
      else if (label.includes('diesel') || label.includes('nafta')) prices.diesel = price;
      else if (label.includes('lpg') || label.includes('autogas')) prices.lpg = price;
    });

    if (!prices.natural95 || !prices.diesel || !prices.lpg) return null;
    return prices;
  } catch {
    return null;
  }
}

async function fetchPrices() {
  const response = await axios.get(URL, { timeout: 10000 });
  return parsePrices(response.data);
}

module.exports = { fetchPrices, parsePrices };
```

- [ ] **Step 6: Run tests — adjust selectors until they pass**

```bash
npm test tests/scraper.test.js
```

If prices come back as `null`, inspect `tests/fixtures/cenik.html` and update the selectors in `parsePrices` until both tests pass.

Expected: both tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/scraper.js tests/scraper.test.js tests/fixtures/cenik.html
git commit -m "feat: scraper module for Tank ONO price page"
```

---

## Task 4: Notifier module

**Files:**
- Create: `src/notifier.js`
- Create: `tests/notifier.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/notifier.test.js`:

```js
const { buildEmailHtml, buildSubject } = require('../src/notifier');

test('buildSubject includes date', () => {
  const subject = buildSubject(new Date('2026-04-17T14:32:00'));
  expect(subject).toContain('17.4.2026');
  expect(subject).toContain('14:32');
});

test('buildEmailHtml shows old and new prices with diff', () => {
  const oldPrices = { natural95: 35.90, diesel: 34.50, lpg: 18.20 };
  const newPrices = { natural95: 36.10, diesel: 34.50, lpg: 17.90 };
  const html = buildEmailHtml(oldPrices, newPrices, 'https://tankono.bagros.eu', 'test@example.com');

  expect(html).toContain('36.10');
  expect(html).toContain('35.90');
  expect(html).toContain('+0.20');
  expect(html).toContain('-0.30');
  expect(html).toContain('unsubscribe');
  expect(html).toContain('test@example.com');
});

test('buildEmailHtml shows dash for unchanged price', () => {
  const prices = { natural95: 34.50, diesel: 34.50, lpg: 18.20 };
  const html = buildEmailHtml(prices, prices, 'https://tankono.bagros.eu', 'test@example.com');
  expect(html).toContain('—');
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test tests/notifier.test.js
```

Expected: FAIL.

- [ ] **Step 3: Write `src/notifier.js`**

```js
const { Resend } = require('resend');
const db = require('./db');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(date) {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return { date: `${d}.${m}.${y}`, time: `${hh}:${mm}` };
}

function buildSubject(date) {
  const { date: d, time: t } = formatDate(date);
  return `Zmena cen Tank ONO - ${d} ${t}`;
}

function fmtDiff(oldVal, newVal) {
  const diff = Math.round((newVal - oldVal) * 100) / 100;
  if (diff === 0) return '—';
  return diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
}

function buildEmailHtml(oldPrices, newPrices, baseUrl, recipientEmail) {
  const rows = [
    { label: 'Natural 95', old: oldPrices.natural95, new: newPrices.natural95 },
    { label: 'Diesel',     old: oldPrices.diesel,    new: newPrices.diesel },
    { label: 'LPG',        old: oldPrices.lpg,       new: newPrices.lpg },
  ];

  const unsubPath = '/unsubscribe?email=' + encodeURIComponent(recipientEmail);
  const unsubLink = baseUrl + unsubPath;

  let tableRows = '';
  for (const r of rows) {
    tableRows +=
      '<tr>' +
      '<td style="padding:6px 12px">' + r.label + '</td>' +
      '<td style="padding:6px 12px">' + r.old.toFixed(2) + ' Kc</td>' +
      '<td style="padding:6px 12px"><strong>' + r.new.toFixed(2) + ' Kc</strong></td>' +
      '<td style="padding:6px 12px">' + fmtDiff(r.old, r.new) + '</td>' +
      '</tr>';
  }

  return (
    '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">' +
    '<h2>Zmena cen Tank ONO</h2>' +
    '<p>Ceny pohonnych hmot na Tank ONO se zmenily.</p>' +
    '<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' +
    '<thead><tr style="background:#f0f0f0">' +
    '<th style="padding:6px 12px;text-align:left">Palivo</th>' +
    '<th style="padding:6px 12px;text-align:left">Stara cena</th>' +
    '<th style="padding:6px 12px;text-align:left">Nova cena</th>' +
    '<th style="padding:6px 12px;text-align:left">Rozdil</th>' +
    '</tr></thead>' +
    '<tbody>' + tableRows + '</tbody>' +
    '</table>' +
    '<p style="margin-top:24px;font-size:12px;color:#999">' +
    '<a href="' + unsubLink + '">unsubscribe</a>' +
    '</p>' +
    '</body></html>'
  );
}

async function sendNotification(oldPrices, newPrices) {
  const subscribers = await db.getSubscribers();
  const owner = process.env.NOTIFY_EMAIL;
  const baseUrl = process.env.BASE_URL;
  const recipients = [...new Set([owner, ...subscribers])].filter(Boolean);
  const subject = buildSubject(new Date());

  for (const email of recipients) {
    try {
      const hostname = new URL(baseUrl).hostname;
      await resend.emails.send({
        from: 'Tank ONO Watcher <noreply@' + hostname + '>',
        to: email,
        subject,
        html: buildEmailHtml(oldPrices, newPrices, baseUrl, email),
      });
    } catch (err) {
      console.error('Failed to send email to ' + email + ':', err.message);
    }
  }
}

module.exports = { sendNotification, buildEmailHtml, buildSubject };
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/notifier.test.js
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/notifier.js tests/notifier.test.js
git commit -m "feat: notifier module with Resend email and unsubscribe link"
```

---

## Task 5: Cron job

**Files:**
- Create: `src/cron.js`

- [ ] **Step 1: Write `src/cron.js`**

```js
const cron = require('node-cron');
const { fetchPrices } = require('./scraper');
const db = require('./db');
const { sendNotification } = require('./notifier');

async function runCheck() {
  console.log('[' + new Date().toISOString() + '] Running price check...');

  let prices;
  try {
    prices = await fetchPrices();
  } catch (err) {
    console.error('Scraper error:', err.message);
    return;
  }

  if (!prices) {
    console.error('Scraper returned null — skipping check.');
    return;
  }

  try {
    const latest = await db.getLatest();
    let changed = false;

    if (latest) {
      const oldPrices = {
        natural95: parseFloat(latest.natural95),
        diesel: parseFloat(latest.diesel),
        lpg: parseFloat(latest.lpg),
      };
      changed =
        oldPrices.natural95 !== prices.natural95 ||
        oldPrices.diesel !== prices.diesel ||
        oldPrices.lpg !== prices.lpg;

      if (changed) {
        await sendNotification(oldPrices, prices);
      }
    }

    await db.saveCheck(prices, changed);
    console.log('Saved. Changed: ' + changed + '. Prices:', prices);
  } catch (err) {
    console.error('DB/notifier error:', err.message);
  }
}

function startCron() {
  cron.schedule('*/5 * * * *', runCheck);
  console.log('Cron started — checking every 5 minutes.');
}

module.exports = { startCron, runCheck };
```

- [ ] **Step 2: Manual smoke test**

```bash
node -e "require('dotenv').config(); require('./src/cron').runCheck();"
```

Expected: `Saved. Changed: false. Prices: { natural95: ..., diesel: ..., lpg: ... }`

If you see `Scraper returned null`, go back to Task 3 Step 6 and fix the selectors.

- [ ] **Step 3: Commit**

```bash
git add src/cron.js
git commit -m "feat: cron job — scrape every 5 minutes, notify on change"
```

---

## Task 6: Express server + API routes

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: Write `src/index.js`**

```js
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
```

- [ ] **Step 2: Start the server**

```bash
npm run dev
```

Expected: `Server running on port 3000` + `Cron started — checking every 5 minutes.`

- [ ] **Step 3: Test API endpoints manually**

```bash
# Current prices
curl http://localhost:3000/api/latest

# History
curl "http://localhost:3000/api/history?days=30"

# Subscribe
curl -X POST http://localhost:3000/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Unsubscribe
curl "http://localhost:3000/unsubscribe?email=test%40example.com"
```

Expected: `latest` returns prices object, `subscribe` returns `{"ok":true}`, `unsubscribe` returns HTML confirmation.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: Express server with API routes and unsubscribe endpoint"
```

---

## Task 7: Web UI

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tank ONO — Sledovani cen</title>
  <link rel="stylesheet" href="style.css" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="container">
    <h1>Tank ONO — Ceny paliv</h1>

    <section class="cards">
      <div class="card">
        <div class="card-label">Natural 95</div>
        <div class="card-price" id="price-natural95">...</div>
        <div class="card-unit">Kc / l</div>
      </div>
      <div class="card">
        <div class="card-label">Diesel</div>
        <div class="card-price" id="price-diesel">...</div>
        <div class="card-unit">Kc / l</div>
      </div>
      <div class="card">
        <div class="card-label">LPG</div>
        <div class="card-price" id="price-lpg">...</div>
        <div class="card-unit">Kc / l</div>
      </div>
    </section>

    <section class="chart-section">
      <h2>Vyvoj cen</h2>
      <canvas id="priceChart"></canvas>
    </section>

    <section class="history-section">
      <h2>Historie zmen</h2>
      <table id="history-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Natural 95</th>
            <th>Diesel</th>
            <th>LPG</th>
          </tr>
        </thead>
        <tbody id="history-body"></tbody>
      </table>
    </section>

    <section class="subscribe-section">
      <h2>Odobirat upozorneni</h2>
      <p>Zadejte email a dostanete zpravu pri kazde zmene cen.</p>
      <form id="subscribe-form">
        <input type="email" id="sub-email" placeholder="vas@email.cz" required />
        <button type="submit">Odobirat</button>
      </form>
      <p id="sub-message" class="sub-message"></p>
    </section>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/style.css`**

```css
*, *::before, *::after { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f7fa;
  color: #1a1a2e;
  margin: 0;
  padding: 0;
}

.container { max-width: 860px; margin: 0 auto; padding: 32px 20px; }
h1 { font-size: 1.8rem; margin-bottom: 28px; }
h2 { font-size: 1.2rem; margin: 32px 0 12px; }

.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
.card { background: #fff; border-radius: 12px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,.07); }
.card-label { font-size: .85rem; color: #666; text-transform: uppercase; letter-spacing: .05em; }
.card-price { font-size: 2.2rem; font-weight: 700; margin: 8px 0 4px; color: #e8501a; }
.card-unit { font-size: .8rem; color: #999; }

.chart-section canvas { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.07); }

#history-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.07); }
#history-table th, #history-table td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #f0f0f0; font-size: .92rem; }
#history-table th { background: #f8f8f8; font-weight: 600; }
#history-table tbody tr:last-child td { border-bottom: none; }

.subscribe-section { margin-top: 40px; }
#subscribe-form { display: flex; gap: 10px; flex-wrap: wrap; }
#subscribe-form input { flex: 1; min-width: 200px; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; }
#subscribe-form button { padding: 10px 22px; background: #e8501a; color: #fff; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
#subscribe-form button:hover { background: #c73f12; }
.sub-message { margin-top: 10px; font-size: .9rem; color: #444; min-height: 1.2em; }
```

- [ ] **Step 3: Create `public/app.js`**

Use safe DOM methods (`textContent`, `createElement`, `appendChild`) instead of `innerHTML` to avoid XSS:

```js
let chart;

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function createCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

async function loadLatest() {
  const res = await fetch('/api/latest');
  const data = await res.json();
  if (!data.natural95) return;
  setText('price-natural95', parseFloat(data.natural95).toFixed(2));
  setText('price-diesel',    parseFloat(data.diesel).toFixed(2));
  setText('price-lpg',       parseFloat(data.lpg).toFixed(2));
}

async function loadHistory() {
  const res = await fetch('/api/history?days=90');
  const rows = await res.json();

  const tbody = document.getElementById('history-body');
  tbody.replaceChildren();
  [...rows].reverse().forEach((r) => {
    const tr = document.createElement('tr');
    tr.appendChild(createCell(new Date(r.checked_at).toLocaleString('cs-CZ')));
    tr.appendChild(createCell(parseFloat(r.natural95).toFixed(2) + ' Kc'));
    tr.appendChild(createCell(parseFloat(r.diesel).toFixed(2) + ' Kc'));
    tr.appendChild(createCell(parseFloat(r.lpg).toFixed(2) + ' Kc'));
    tbody.appendChild(tr);
  });

  const labels = rows.map((r) => new Date(r.checked_at).toLocaleDateString('cs-CZ'));
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Natural 95', data: rows.map((r) => parseFloat(r.natural95)), borderColor: '#e8501a', tension: 0.3, fill: false },
        { label: 'Diesel',     data: rows.map((r) => parseFloat(r.diesel)),    borderColor: '#2563eb', tension: 0.3, fill: false },
        { label: 'LPG',        data: rows.map((r) => parseFloat(r.lpg)),       borderColor: '#16a34a', tension: 0.3, fill: false },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: false } },
    },
  });
}

document.getElementById('subscribe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('sub-email').value.trim();
  const msg = document.getElementById('sub-message');
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    msg.textContent = res.ok
      ? 'Prihlaseni uspesne! Budete dostávat upozorneni na zmeny cen.'
      : 'Chyba: ' + data.error;
  } catch {
    msg.textContent = 'Nastala chyba. Zkuste to znovu.';
  }
});

loadLatest();
loadHistory();
```

- [ ] **Step 4: Open in browser and verify**

With the server running (`npm run dev`), open `http://localhost:3000`.

Check:
- 3 price cards show current prices
- Chart renders (will be empty until at least 2 `changed=true` records exist in DB)
- History table shows rows
- Subscribe form submits and shows success message

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat: web dashboard with price cards, chart, history table and subscribe form"
```

---

## Task 8: Deployment config

**Files:**
- Create: `ecosystem.config.js`
- Create: `README.md`

- [ ] **Step 1: Create `ecosystem.config.js` for pm2**

```js
module.exports = {
  apps: [
    {
      name: 'tankono-watcher',
      script: 'src/index.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Tank ONO Watcher

Scrapes Tank ONO fuel prices every 5 minutes. Emails all subscribers when prices change. Web dashboard on subdomain.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in values
3. Create DB tables (SQL in the design spec)
4. `npm start`

## VPS deployment (pm2)

    npm install -g pm2
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup

## Nginx config

    server {
        server_name tankono.bagros.eu;
        location / {
            proxy_pass http://localhost:3000;
            proxy_set_header Host $host;
        }
    }
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Final commit**

```bash
git add ecosystem.config.js README.md
git commit -m "feat: pm2 config and deployment docs"
```

---

## Self-Review

**Spec coverage:**
- Scraper (Task 3) ✓
- DB with both tables `price_checks` + `subscribers` (Task 2) ✓
- Notifier + Resend + per-recipient unsubscribe link (Task 4) ✓
- Cron every 5 minutes (Task 5) ✓
- All 4 API endpoints: `/api/latest`, `/api/history`, `/api/subscribe`, `/unsubscribe` (Task 6) ✓
- Web UI: cards + chart + history table + subscribe form (Task 7) ✓
- Error handling: scraper null → skip, DB error → log, Resend fail per-recipient → log (Tasks 4, 5) ✓
- `.env` with `BASE_URL` (Tasks 1, 4) ✓

**No placeholders.**

**Type consistency:** `prices` object is always `{ natural95, diesel, lpg }` as `number` throughout all modules. MySQL DECIMAL columns come back as strings — consistently wrapped with `parseFloat()` in `cron.js` and `app.js`. ✓
