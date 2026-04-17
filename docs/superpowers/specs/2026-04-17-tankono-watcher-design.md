# Tank ONO Watcher — Design Spec
**Date:** 2026-04-17

## Overview

Standalone Node.js server hosted on a personal VPS that scrapes the Tank ONO fuel price list every 5 minutes, stores every check in MySQL, sends an email via Resend when prices change, and serves a web dashboard on a subdomain showing current prices plus historical data. Anyone can subscribe on the web by entering their email — subscribers are stored in the DB and all receive notifications on price change.

---

## Architecture

### Components

1. **Scraper** (`src/scraper.js`)
   - Uses `axios` to fetch `https://www.tank-ono.cz/cz/index.php?page=cenik`
   - Uses `cheerio` to parse Natural 95, Diesel, and LPG prices from the HTML
   - Returns a plain object `{ natural95, diesel, lpg }`

2. **Database** (`src/db.js`)
   - Connects to MySQL at `db.bagros.eu`
   - Provides functions:
     - `saveCheck(prices, changed)` — inserts a row into `price_checks`
     - `getLatest()` — returns the most recent row
     - `getHistory(days)` — returns rows where `changed = true` from the last N days
     - `addSubscriber(email)` — inserts email into `subscribers` (ignores duplicate)
     - `removeSubscriber(email)` — deletes by email
     - `getSubscribers()` — returns all active subscriber emails

3. **Notifier** (`src/notifier.js`)
   - Uses Resend API to send an email when prices change
   - Fetches all subscribers from DB, sends to each one
   - Also always sends to `NOTIFY_EMAIL` from `.env` (owner)
   - Email contains: timestamp, old vs new price for each fuel type, difference (+/-)
   - Each email includes a one-click unsubscribe link: `GET /unsubscribe?email=...`

4. **Cron Job** (`src/cron.js`)
   - Runs every 5 minutes using `node-cron`
   - Calls scraper → compares with last DB entry → saves record → triggers notifier if changed

5. **Express Server** (`src/index.js`)
   - Serves the static web UI from `public/`
   - Exposes REST API:
     - `GET /api/latest` — returns the most recent price record
     - `GET /api/history?days=30` — returns changed-only records for the last N days (default 30)
     - `POST /api/subscribe` — body `{ email }`, adds subscriber to DB
     - `GET /unsubscribe?email=...` — removes subscriber, returns a simple confirmation HTML page

6. **Web UI** (`public/`)
   - `index.html` + `style.css` + `app.js`
   - No framework — vanilla JS, Chart.js via CDN
   - Layout:
     - **Top section:** 3 cards — Natural 95 / Diesel / LPG current price
     - **Chart:** Line chart (Chart.js) showing price history over time
     - **Table:** All price-change events with timestamp and values
     - **Subscribe section:** Email input + "Odebírat" button → `POST /api/subscribe`

---

## Database Schema

**Table: `price_checks`**

| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT PRIMARY KEY | |
| checked_at | DATETIME NOT NULL | UTC timestamp of the check |
| natural95 | DECIMAL(5,2) NOT NULL | Price in CZK |
| diesel | DECIMAL(5,2) NOT NULL | Price in CZK |
| lpg | DECIMAL(5,2) NOT NULL | Price in CZK |
| changed | TINYINT(1) NOT NULL DEFAULT 0 | 1 if any price changed vs previous check |

**Table: `subscribers`**

| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT PRIMARY KEY | |
| email | VARCHAR(255) NOT NULL UNIQUE | |
| subscribed_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

---

## Email Format

Subject: `⛽ Změna cen Tank ONO – 17.4.2026 14:32`

Body (HTML):
```
Ceny pohonných hmot na Tank ONO se změnily.

Palivo       | Stará cena | Nová cena | Rozdíl
-------------|------------|-----------|-------
Natural 95   | 35.90 Kč   | 36.10 Kč  | +0.20
Diesel       | 34.50 Kč   | 34.50 Kč  | —
LPG          | 18.20 Kč   | 17.90 Kč  | -0.30
```

---

## Configuration (`.env`)

```
PORT=3000
DB_HOST=db.bagros.eu
DB_USER=...
DB_PASSWORD=...
DB_NAME=tankono
RESEND_API_KEY=...
NOTIFY_EMAIL=david@...
BASE_URL=https://tankono.bagros.eu   # used for unsubscribe links in emails
```

---

## Project Structure

```
tankono-watcher/
├── src/
│   ├── scraper.js
│   ├── db.js
│   ├── notifier.js
│   ├── cron.js
│   └── index.js
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .env
├── .env.example
├── package.json
└── Dockerfile          # optional, for VPS deployment
```

---

## Deployment

- Hosted on personal VPS
- Web accessible on a subdomain (e.g. `tankono.bagros.eu`)
- Process managed by `pm2` or `docker-compose`
- Nginx reverse proxy → port 3000

---

## Error Handling

- If scraper fails (network error, HTML structure changed): log error, skip the check, do NOT send an email — avoid false positives
- If DB is unreachable: log error, retry on next cron tick
- If Resend fails: log error, do not retry (will notify on next actual change)

---

## Out of Scope

- Email verification (double opt-in) for subscribers
- User authentication on the web
- Mobile push notifications
- Multiple fuel station chains
