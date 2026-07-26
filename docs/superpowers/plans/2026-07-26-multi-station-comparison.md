# Multi-Station Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-source Tank ONO watcher into a multi-station price comparison for Ústí nad Labem, with a leaderboard dashboard and batched change-notification emails, keeping the existing warm-paper design.

**Architecture:** Add a `stations` table and a `station_id` FK on `price_checks`. A scraper registry runs the existing Tank ONO official scraper plus a new mbenzin scraper (two fuel-listing pages joined by each station's stable numeric id). The cron loop does per-station change detection and batches all changes in a cycle into one digest email. A pure `leaderboard` module computes ranking and "last move"; the API exposes a leaderboard endpoint the refined frontend renders.

**Tech Stack:** Node.js, Express 5, node-cron, cheerio, mysql2, Resend, Jest. Chart.js on the frontend (CDN, unchanged).

## Global Constraints

- Node CommonJS (`require`/`module.exports`), matching the existing codebase.
- All UI copy in Czech, matching existing tone (e.g. "Poslední posun", "beze změny").
- Warm-paper palette only — reuse existing CSS variables in `public/style.css`; do not introduce a new color system.
- Prices are `DECIMAL(5,2)`; always compare as `Number(...)` and round deltas with `Math.round(x*100)/100`.
- Timezone for all displayed/logged times: `Europe/Prague`.
- City is fixed to `usti-nad-labem` (a module-level constant, not hardcoded inline in loops).
- mbenzin station identity is the numeric `@id` from the listing markup; station `slug` = `mbenzin-<id>`. Tank ONO's slug is `tank-ono`.
- Persisted/tracked mbenzin stations = those listing BOTH Natural 95 and Diesel, excluding any row whose name is exactly `Tank ONO`.
- Leaderboard displays the **10 cheapest by Natural 95** (ties broken by Diesel), Tank ONO always included in the ranking.

---

## File Structure

- `schema.sql` — MODIFY: add `stations` table + `station_id` column.
- `scripts/migrate-multistation.js` — CREATE: idempotent migration + backfill.
- `src/scrapers/tankOno.js` — CREATE: the current `src/scraper.js` logic, moved.
- `src/scrapers/mbenzin.js` — CREATE: parse + join the two mbenzin fuel pages.
- `src/scrapers/index.js` — CREATE: `scrapeAll()` registry.
- `src/scraper.js` — DELETE (moved to `src/scrapers/tankOno.js`).
- `src/leaderboard.js` — CREATE: pure `computeLastMove` + `rankStations`.
- `src/db.js` — MODIFY: station-aware data access.
- `src/cron.js` — MODIFY: per-station loop + change batching.
- `src/notifier.js` — MODIFY: digest email for N stations.
- `src/index.js` — MODIFY: `/api/stations/latest`, station-aware `/api/history`.
- `public/index.html`, `public/app.js`, `public/style.css` — MODIFY: leaderboard section.
- Tests: `tests/scrapers/tankOno.test.js`, `tests/scrapers/mbenzin.test.js`, `tests/leaderboard.test.js`, `tests/notifier.test.js` (update), `tests/db.test.js` (update).
- Fixtures (already saved): `tests/fixtures/cenik.html`, `tests/fixtures/mbenzin-listing.html`, `tests/fixtures/mbenzin-nafta.html`.

---

## Task 1: Database schema + migration

**Files:**
- Modify: `schema.sql`
- Create: `scripts/migrate-multistation.js`

**Interfaces:**
- Produces: `stations(id, slug, name, source, is_primary, sort_order, created_at)`; `price_checks.station_id` FK. After this task the DB has exactly one primary station (`slug='tank-ono'`) and all pre-existing `price_checks` rows point to it.

- [ ] **Step 1: Update `schema.sql`**

Replace the `price_checks` block and add `stations`. Final `schema.sql`:

```sql
CREATE DATABASE IF NOT EXISTS tankono;
USE tankono;

CREATE TABLE IF NOT EXISTS stations (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(64)  NOT NULL UNIQUE,
  name       VARCHAR(128) NOT NULL,
  source     ENUM('tank_ono','mbenzin') NOT NULL,
  is_primary TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_checks (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  station_id INT UNSIGNED NOT NULL,
  checked_at DATETIME NOT NULL,
  natural95  DECIMAL(5,2) NOT NULL,
  diesel     DECIMAL(5,2) NOT NULL,
  changed    TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_station_time (station_id, checked_at),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: Write the migration script `scripts/migrate-multistation.js`**

Idempotent so it is safe to run on the live DB (which already has `price_checks` without `station_id`).

```js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // 1) stations table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS stations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(128) NOT NULL,
      source ENUM('tank_ono','mbenzin') NOT NULL,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  // 2) primary Tank ONO station
  await conn.execute(
    `INSERT IGNORE INTO stations (slug, name, source, is_primary, sort_order)
     VALUES ('tank-ono', 'Tank ONO', 'tank_ono', 1, 0)`
  );
  const [[ono]] = await conn.query(`SELECT id FROM stations WHERE slug='tank-ono'`);
  const tankOnoId = ono.id;

  // 3) add station_id column (nullable first) if missing
  if (!(await columnExists(conn, 'price_checks', 'station_id'))) {
    await conn.execute(`ALTER TABLE price_checks ADD COLUMN station_id INT UNSIGNED NULL AFTER id`);
  }

  // 4) backfill existing rows to Tank ONO
  const [r] = await conn.execute(
    `UPDATE price_checks SET station_id = ? WHERE station_id IS NULL`, [tankOnoId]
  );
  console.log('Backfilled rows:', r.affectedRows);

  // 5) enforce NOT NULL + index + FK (guard against re-run errors)
  await conn.execute(`ALTER TABLE price_checks MODIFY station_id INT UNSIGNED NOT NULL`);
  try { await conn.execute(`ALTER TABLE price_checks ADD INDEX idx_station_time (station_id, checked_at)`); }
  catch (e) { if (!/Duplicate key name/.test(e.message)) throw e; }
  try { await conn.execute(`ALTER TABLE price_checks ADD FOREIGN KEY (station_id) REFERENCES stations(id)`); }
  catch (e) { if (!/Duplicate|foreign key constraint/i.test(e.message)) throw e; }

  console.log('Migration complete. Tank ONO station id =', tankOnoId);
  await conn.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 3: Commit**

```bash
git add schema.sql scripts/migrate-multistation.js
git commit -m "feat: stations table + station_id migration"
```

---

## Task 2: Leaderboard pure logic

Pure functions, no DB — fully unit-testable.

**Files:**
- Create: `src/leaderboard.js`
- Test: `tests/leaderboard.test.js`

**Interfaces:**
- Produces:
  - `computeLastMove(rows)` — `rows` ascending by `checked_at`, each `{ natural95, diesel, checked_at }`. Returns `Array<{ fuel: 'natural95'|'diesel', from: number, to: number, delta: number, direction: 'up'|'down', at: <checked_at> }>` for the most recent check where any fuel differs from the previous check (0, 1, or 2 entries; `[]` if never changed).
  - `rankStations(stations, limit)` — `stations`: `Array<{ slug, name, is_primary, natural95, diesel, lastMove }>`. Returns the cheapest `limit` (default 10) sorted ascending by `natural95` then `diesel`, each with a `rank` (1-based) added.

- [ ] **Step 1: Write the failing test `tests/leaderboard.test.js`**

```js
const { computeLastMove, rankStations } = require('../src/leaderboard');

describe('computeLastMove', () => {
  test('returns [] when history never changes', () => {
    const rows = [
      { natural95: 39.5, diesel: 38.9, checked_at: '2026-07-20T10:00:00' },
      { natural95: 39.5, diesel: 38.9, checked_at: '2026-07-20T10:05:00' },
    ];
    expect(computeLastMove(rows)).toEqual([]);
  });

  test('detects a single-fuel drop at the latest change', () => {
    const rows = [
      { natural95: 39.9, diesel: 38.9, checked_at: '2026-07-20T10:00:00' },
      { natural95: 39.5, diesel: 38.9, checked_at: '2026-07-20T12:00:00' },
    ];
    const moves = computeLastMove(rows);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ fuel: 'natural95', delta: -0.4, direction: 'down', at: '2026-07-20T12:00:00' });
  });

  test('returns both fuels when both change in the same check', () => {
    const rows = [
      { natural95: 39.9, diesel: 38.9, checked_at: '2026-07-20T10:00:00' },
      { natural95: 40.1, diesel: 38.5, checked_at: '2026-07-20T12:00:00' },
    ];
    const moves = computeLastMove(rows);
    expect(moves.map((m) => m.fuel).sort()).toEqual(['diesel', 'natural95']);
    expect(moves.find((m) => m.fuel === 'natural95').direction).toBe('up');
    expect(moves.find((m) => m.fuel === 'diesel').direction).toBe('down');
  });

  test('reports the most recent change, not an older one', () => {
    const rows = [
      { natural95: 40.0, diesel: 38.0, checked_at: '2026-07-18T10:00:00' },
      { natural95: 39.5, diesel: 38.0, checked_at: '2026-07-19T10:00:00' }, // n95 change
      { natural95: 39.5, diesel: 37.5, checked_at: '2026-07-20T10:00:00' }, // diesel change (latest)
    ];
    const moves = computeLastMove(rows);
    expect(moves).toHaveLength(1);
    expect(moves[0].fuel).toBe('diesel');
  });
});

describe('rankStations', () => {
  const stations = [
    { slug: 'a', name: 'A', is_primary: 0, natural95: 40.5, diesel: 39.9, lastMove: [] },
    { slug: 'tank-ono', name: 'Tank ONO', is_primary: 1, natural95: 39.5, diesel: 38.9, lastMove: [] },
    { slug: 'b', name: 'B', is_primary: 0, natural95: 40.5, diesel: 39.5, lastMove: [] },
  ];

  test('sorts by natural95 then diesel and assigns rank', () => {
    const ranked = rankStations(stations, 10);
    expect(ranked.map((s) => s.slug)).toEqual(['tank-ono', 'b', 'a']);
    expect(ranked.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  test('caps to the limit', () => {
    expect(rankStations(stations, 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/leaderboard.test.js`
Expected: FAIL — "Cannot find module '../src/leaderboard'".

- [ ] **Step 3: Implement `src/leaderboard.js`**

```js
const FUELS = ['natural95', 'diesel'];

function computeLastMove(rows) {
  for (let i = rows.length - 1; i >= 1; i--) {
    const cur = rows[i];
    const prev = rows[i - 1];
    const moves = [];
    for (const fuel of FUELS) {
      const from = Number(prev[fuel]);
      const to = Number(cur[fuel]);
      if (from !== to) {
        const delta = Math.round((to - from) * 100) / 100;
        moves.push({ fuel, from, to, delta, direction: delta > 0 ? 'up' : 'down', at: cur.checked_at });
      }
    }
    if (moves.length) return moves;
  }
  return [];
}

function rankStations(stations, limit = 10) {
  return [...stations]
    .sort((a, b) => Number(a.natural95) - Number(b.natural95) || Number(a.diesel) - Number(b.diesel))
    .slice(0, limit)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

module.exports = { computeLastMove, rankStations };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/leaderboard.test.js`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/leaderboard.js tests/leaderboard.test.js
git commit -m "feat: leaderboard ranking + last-move logic"
```

---

## Task 3: Move Tank ONO scraper into the registry directory

Pure move + re-home of tests. No behavior change.

**Files:**
- Create: `src/scrapers/tankOno.js` (content = current `src/scraper.js`)
- Delete: `src/scraper.js`
- Create: `tests/scrapers/tankOno.test.js` (content = current `tests/scraper.test.js`, path fixed)
- Delete: `tests/scraper.test.js`

**Interfaces:**
- Produces: `require('../src/scrapers/tankOno')` → `{ fetchPrices, parsePrices, KEY }` where `KEY = 'tank-ono'`, `fetchPrices()` → `{ natural95, diesel } | null`.

- [ ] **Step 1: Create `src/scrapers/tankOno.js`**

Copy `src/scraper.js` verbatim, then add a `KEY` export. At the top-level of the file add:

```js
const KEY = 'tank-ono';
```

and change the final export line to:

```js
module.exports = { fetchPrices, parsePrices, KEY };
```

- [ ] **Step 2: Move the test**

Copy `tests/scraper.test.js` to `tests/scrapers/tankOno.test.js`. In the copy, fix the require paths (one directory deeper):
- `require('../src/scraper')` → `require('../../src/scrapers/tankOno')`
- fixture path `./fixtures/cenik.html` or `__dirname` references → `path.join(__dirname, '..', 'fixtures', 'cenik.html')`.

- [ ] **Step 3: Delete the old files**

```bash
git rm src/scraper.js tests/scraper.test.js
```

- [ ] **Step 4: Run the moved test**

Run: `npx jest tests/scrapers/tankOno.test.js`
Expected: PASS (same assertions as before the move).

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/tankOno.js tests/scrapers/tankOno.test.js
git commit -m "refactor: move Tank ONO scraper into scrapers/ registry"
```

---

## Task 4: mbenzin scraper (parse + join two fuel pages)

**Files:**
- Create: `src/scrapers/mbenzin.js`
- Test: `tests/scrapers/mbenzin.test.js`
- Fixtures (already present): `tests/fixtures/mbenzin-listing.html` (Natural 95), `tests/fixtures/mbenzin-nafta.html` (Diesel)

**Interfaces:**
- Produces:
  - `parseListing(html, fuelKey)` → `Array<{ id: string, name: string, [fuelKey]: number|null }>`.
  - `joinFuels(n95List, dieselList)` → `Array<{ id, name, natural95, diesel }>` containing only stations with BOTH prices present and `name !== 'Tank ONO'`.
  - `fetchStations()` → same shape as `joinFuels`, fetching both live URLs.
  - Constant `CITY = 'usti-nad-labem'`.

- [ ] **Step 1: Write the failing test `tests/scrapers/mbenzin.test.js`**

```js
const fs = require('fs');
const path = require('path');
const { parseListing, joinFuels } = require('../../src/scrapers/mbenzin');

const n95Html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mbenzin-listing.html'), 'utf8');
const dieselHtml = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'mbenzin-nafta.html'), 'utf8');

describe('parseListing', () => {
  test('parses Natural 95 stations with id, name, price', () => {
    const list = parseListing(n95Html, 'natural95');
    expect(list.length).toBeGreaterThan(20);
    const vs = list.find((s) => s.id === '18065');
    expect(vs).toMatchObject({ id: '18065', name: 'VS Petrol', natural95: 39.5 });
  });

  test('parses Diesel stations', () => {
    const list = parseListing(dieselHtml, 'diesel');
    const mol = list.find((s) => s.id === '18148');
    expect(mol).toMatchObject({ id: '18148', name: 'MOL', diesel: 37.5 });
  });
});

describe('joinFuels', () => {
  test('keeps only both-fuel stations and drops Tank ONO rows', () => {
    const joined = joinFuels(parseListing(n95Html, 'natural95'), parseListing(dieselHtml, 'diesel'));
    expect(joined.every((s) => s.natural95 != null && s.diesel != null)).toBe(true);
    expect(joined.some((s) => s.name === 'Tank ONO')).toBe(false);
    const vs = joined.find((s) => s.id === '18065');
    expect(vs).toMatchObject({ name: 'VS Petrol', natural95: 39.5, diesel: 42.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/scrapers/mbenzin.test.js`
Expected: FAIL — "Cannot find module '../../src/scrapers/mbenzin'".

- [ ] **Step 3: Implement `src/scrapers/mbenzin.js`**

```js
const axios = require('axios');
const cheerio = require('cheerio');

const CITY = 'usti-nad-labem';
const N95_URL = `https://www.mbenzin.cz/Nejlevnejsi-benzin/${CITY}`;
const DIESEL_URL = `https://www.mbenzin.cz/Nejlevnejsi-nafta/${CITY}`;
const UA = 'Mozilla/5.0 (compatible; DejnyHlidac/1.0; +https://beno.dejny.eu)';

function parsePrice(raw) {
  const cleaned = (raw || '').trim().replace(',', '.').replace(/[^\d.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) || value === 0 ? null : value;
}

/**
 * Each station is a microdata block: itemtype .../LocalBusiness with an
 * [itemprop="name"] and a <meta itemprop="@id" content="12345">. The price
 * sits in a div immediately after a label div reading "Cena benzínu" (N95)
 * or "Cena nafty" (Diesel).
 */
function parseListing(html, fuelKey) {
  const $ = cheerio.load(html);
  const out = [];
  $('[itemtype="http://www.data-vocabulary.org/LocalBusiness"]').each((_, el) => {
    const card = $(el);
    const name = card.find('[itemprop="name"]').first().text().trim();
    const id = card.find('meta[itemprop="@id"]').attr('content');
    if (!name || !id) return;
    let price = null;
    card.find('.text-muted.font-s-07r').each((__, lbl) => {
      const label = $(lbl).text().trim();
      if (label === 'Cena benzínu' || label === 'Cena nafty') {
        price = parsePrice($(lbl).next().text());
      }
    });
    out.push({ id: String(id), name, [fuelKey]: price });
  });
  return out;
}

function joinFuels(n95List, dieselList) {
  const byId = new Map();
  for (const s of n95List) byId.set(s.id, { id: s.id, name: s.name, natural95: s.natural95, diesel: null });
  for (const s of dieselList) {
    const entry = byId.get(s.id) || { id: s.id, name: s.name, natural95: null, diesel: null };
    entry.diesel = s.diesel;
    byId.set(s.id, entry);
  }
  return [...byId.values()].filter(
    (s) => s.natural95 != null && s.diesel != null && s.name !== 'Tank ONO'
  );
}

async function fetchStations() {
  const opts = { timeout: 10000, headers: { 'User-Agent': UA } };
  const [n95, diesel] = await Promise.all([
    axios.get(N95_URL, opts).then((r) => parseListing(r.data, 'natural95')),
    axios.get(DIESEL_URL, opts).then((r) => parseListing(r.data, 'diesel')),
  ]);
  return joinFuels(n95, diesel);
}

module.exports = { parseListing, joinFuels, fetchStations, CITY };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/scrapers/mbenzin.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/mbenzin.js tests/scrapers/mbenzin.test.js
git commit -m "feat: mbenzin scraper (join N95 + Diesel listings by station id)"
```

---

## Task 5: Scraper registry `scrapeAll()`

**Files:**
- Create: `src/scrapers/index.js`
- Test: `tests/scrapers/registry.test.js`

**Interfaces:**
- Consumes: `tankOno.fetchPrices()`, `mbenzin.fetchStations()`.
- Produces: `scrapeAll()` → `Array<{ slug, name, source, isPrimary, natural95, diesel }>`. Tank ONO first (`slug:'tank-ono', source:'tank_ono', isPrimary:true`); each mbenzin station follows (`slug:'mbenzin-'+id, source:'mbenzin', isPrimary:false`). If a scraper fails/returns null it contributes nothing (registry never throws).

- [ ] **Step 1: Write the failing test `tests/scrapers/registry.test.js`**

Uses `jest.mock` so no network is hit.

```js
jest.mock('../../src/scrapers/tankOno', () => ({
  fetchPrices: jest.fn(),
  KEY: 'tank-ono',
}));
jest.mock('../../src/scrapers/mbenzin', () => ({
  fetchStations: jest.fn(),
}));

const tankOno = require('../../src/scrapers/tankOno');
const mbenzin = require('../../src/scrapers/mbenzin');
const { scrapeAll } = require('../../src/scrapers/index');

beforeEach(() => jest.clearAllMocks());

test('combines Tank ONO (primary) and mbenzin stations', async () => {
  tankOno.fetchPrices.mockResolvedValue({ natural95: 39.5, diesel: 38.9 });
  mbenzin.fetchStations.mockResolvedValue([
    { id: '18065', name: 'VS Petrol', natural95: 40.5, diesel: 39.9 },
  ]);
  const all = await scrapeAll();
  expect(all[0]).toMatchObject({ slug: 'tank-ono', source: 'tank_ono', isPrimary: true, natural95: 39.5, diesel: 38.9 });
  expect(all[1]).toMatchObject({ slug: 'mbenzin-18065', name: 'VS Petrol', source: 'mbenzin', isPrimary: false, natural95: 40.5 });
});

test('skips a scraper that fails, keeps the other', async () => {
  tankOno.fetchPrices.mockResolvedValue(null);
  mbenzin.fetchStations.mockRejectedValue(new Error('network'));
  const all = await scrapeAll();
  expect(all).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/scrapers/registry.test.js`
Expected: FAIL — "Cannot find module '../../src/scrapers/index'".

- [ ] **Step 3: Implement `src/scrapers/index.js`**

```js
const tankOno = require('./tankOno');
const mbenzin = require('./mbenzin');

async function scrapeAll() {
  const results = [];

  try {
    const ono = await tankOno.fetchPrices();
    if (ono) {
      results.push({
        slug: 'tank-ono', name: 'Tank ONO', source: 'tank_ono',
        isPrimary: true, natural95: ono.natural95, diesel: ono.diesel,
      });
    }
  } catch (err) {
    console.error('tankOno scraper failed:', err.message);
  }

  try {
    const stations = await mbenzin.fetchStations();
    for (const s of stations) {
      results.push({
        slug: 'mbenzin-' + s.id, name: s.name, source: 'mbenzin',
        isPrimary: false, natural95: s.natural95, diesel: s.diesel,
      });
    }
  } catch (err) {
    console.error('mbenzin scraper failed:', err.message);
  }

  return results;
}

module.exports = { scrapeAll };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/scrapers/registry.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/index.js tests/scrapers/registry.test.js
git commit -m "feat: scraper registry scrapeAll()"
```

---

## Task 6: Station-aware data access in `db.js`

**Files:**
- Modify: `src/db.js`
- Test: `tests/db.test.js` (update — integration test, requires a test `DATABASE_URL`)

**Interfaces:**
- Produces (all on the exported `db` object):
  - `upsertStation({ slug, name, source, isPrimary })` → `stationId` (number). Inserts if new, updates `name`, returns id.
  - `getStations()` → `Array<{ id, slug, name, source, is_primary, sort_order }>`.
  - `saveCheck(stationId, prices, changed)` — now takes `stationId` first.
  - `getLatest2ForStation(stationId)` → `[newest, secondNewest]` rows (may be empty).
  - `getRecentForStation(stationId, limit)` → up to `limit` rows **ascending** by `checked_at` (for `computeLastMove`).
  - `getLatestForStation(stationId)` → newest row or null.
  - `getHistoryForStation(stationId, days)` → rows ascending (chart/history).
  - `deleteRecord(id)` — unchanged.
  - Subscriber functions — unchanged.
- Consumes: `stations`, `price_checks` tables from Task 1.

- [ ] **Step 1: Update `tests/db.test.js` for the new signatures**

Replace the price-check tests (subscriber tests stay). New content for the price-check portion:

```js
require('dotenv').config();
const db = require('../src/db');

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('test')) {
  console.warn('WARNING: DATABASE_URL does not contain "test". db tests will DELETE data.');
}

let stationId;

beforeAll(async () => {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  await conn.execute('DELETE FROM price_checks');
  await conn.execute('DELETE FROM subscribers');
  await conn.execute("DELETE FROM stations WHERE slug='test-station'");
  await conn.end();
  stationId = await db.upsertStation({ slug: 'test-station', name: 'Test', source: 'mbenzin', isPrimary: false });
});

test('upsertStation is idempotent and updates name', async () => {
  const again = await db.upsertStation({ slug: 'test-station', name: 'Test Renamed', source: 'mbenzin', isPrimary: false });
  expect(again).toBe(stationId);
  const stations = await db.getStations();
  expect(stations.find((s) => s.id === stationId).name).toBe('Test Renamed');
});

test('saveCheck + getLatestForStation round-trip', async () => {
  await db.saveCheck(stationId, { natural95: 36.10, diesel: 34.50 }, true);
  const latest = await db.getLatestForStation(stationId);
  expect(parseFloat(latest.natural95)).toBeCloseTo(36.10);
  expect(parseFloat(latest.diesel)).toBeCloseTo(34.50);
});

test('getRecentForStation returns ascending rows', async () => {
  await db.saveCheck(stationId, { natural95: 36.20, diesel: 34.50 }, true);
  const rows = await db.getRecentForStation(stationId, 10);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  const times = rows.map((r) => new Date(r.checked_at).getTime());
  expect(times).toEqual([...times].sort((a, b) => a - b));
});
```

(Keep the existing `addSubscriber` / `getSubscribers` / `removeSubscriber` tests unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/db.test.js`
Expected: FAIL — `db.upsertStation is not a function` (or DB error if no test DB configured; if you have no test DB, skip running this integration test and verify by reading the implementation).

- [ ] **Step 3: Implement the new functions in `src/db.js`**

Replace the module body's price-check functions with station-aware versions and add station functions. Full new `src/db.js`:

```js
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool(process.env.DATABASE_URL);

async function upsertStation({ slug, name, source, isPrimary }) {
  await pool.execute(
    `INSERT INTO stations (slug, name, source, is_primary) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [slug, name, source, isPrimary ? 1 : 0]
  );
  const [[row]] = await pool.query('SELECT id FROM stations WHERE slug = ?', [slug]);
  return row.id;
}

async function getStations() {
  const [rows] = await pool.query(
    'SELECT id, slug, name, source, is_primary, sort_order FROM stations ORDER BY is_primary DESC, sort_order, name'
  );
  return rows;
}

async function saveCheck(stationId, prices, changed) {
  await pool.execute(
    'INSERT INTO price_checks (station_id, checked_at, natural95, diesel, changed) VALUES (?, NOW(), ?, ?, ?)',
    [stationId, prices.natural95, prices.diesel, changed ? 1 : 0]
  );
}

async function getLatestForStation(stationId) {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks WHERE station_id = ? ORDER BY checked_at DESC LIMIT 1',
    [stationId]
  );
  return rows[0] || null;
}

async function getLatest2ForStation(stationId) {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks WHERE station_id = ? ORDER BY checked_at DESC LIMIT 2',
    [stationId]
  );
  return rows; // [newest, second-newest]
}

async function getRecentForStation(stationId, limit = 60) {
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 60, 500));
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT * FROM price_checks WHERE station_id = ? ORDER BY checked_at DESC LIMIT ?
     ) t ORDER BY checked_at ASC`,
    [stationId, lim]
  );
  return rows;
}

async function getHistoryForStation(stationId, days = 30) {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks WHERE station_id = ? AND checked_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY checked_at ASC LIMIT 300',
    [stationId, days]
  );
  return rows;
}

async function deleteRecord(id) {
  await pool.execute('DELETE FROM price_checks WHERE id = ?', [id]);
}

async function addSubscriber(email) {
  await pool.execute('INSERT IGNORE INTO subscribers (email) VALUES (?)', [email]);
}

async function removeSubscriber(email) {
  await pool.execute('DELETE FROM subscribers WHERE email = ?', [email]);
}

async function getSubscribers() {
  const [rows] = await pool.execute('SELECT email FROM subscribers');
  return rows.map((r) => r.email);
}

module.exports = {
  upsertStation, getStations,
  saveCheck, getLatestForStation, getLatest2ForStation,
  getRecentForStation, getHistoryForStation, deleteRecord,
  addSubscriber, removeSubscriber, getSubscribers,
};
```

Note: `LIMIT ?` with mysql2 requires `pool.query` (not `execute`) — that is why `getRecentForStation` uses `query`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/db.test.js`
Expected: PASS (with a test DB). Without a test DB, confirm by review that every exported name matches the Interfaces block.

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: station-aware data access in db.js"
```

---

## Task 7: Multi-station cron loop with change batching

**Files:**
- Modify: `src/cron.js`
- Test: `tests/cron.test.js` (create — mocks db, scrapers, notifier)

**Interfaces:**
- Consumes: `scrapeAll()`, `db.upsertStation`, `db.getLatest2ForStation`, `db.saveCheck`, `db.deleteRecord`, `notifier.sendNotification(changes)`.
- Produces: `runCheck()` and `startCron()`. `sendNotification` is called at most once per cycle with `changes = Array<{ slug, name, old:{natural95,diesel}, new:{natural95,diesel} }>` and only for stations that already had a prior reading (no email on a station's first-ever save).

- [ ] **Step 1: Write the failing test `tests/cron.test.js`**

```js
jest.mock('../src/scrapers/index', () => ({ scrapeAll: jest.fn() }));
jest.mock('../src/notifier', () => ({ sendNotification: jest.fn() }));
jest.mock('../src/db', () => ({
  upsertStation: jest.fn(),
  getLatest2ForStation: jest.fn(),
  saveCheck: jest.fn(),
  deleteRecord: jest.fn(),
}));

const { scrapeAll } = require('../src/scrapers/index');
const db = require('../src/db');
const notifier = require('../src/notifier');
const { runCheck } = require('../src/cron');

beforeEach(() => {
  jest.clearAllMocks();
  db.upsertStation.mockImplementation(async (s) => (s.slug === 'tank-ono' ? 1 : 2));
});

test('batches all changed stations into a single notification', async () => {
  scrapeAll.mockResolvedValue([
    { slug: 'tank-ono', name: 'Tank ONO', source: 'tank_ono', isPrimary: true, natural95: 39.5, diesel: 38.9 },
    { slug: 'mbenzin-18065', name: 'VS Petrol', source: 'mbenzin', isPrimary: false, natural95: 40.5, diesel: 39.9 },
  ]);
  // Both stations have a prior, different reading -> both changed.
  db.getLatest2ForStation.mockImplementation(async (id) =>
    id === 1
      ? [{ id: 11, natural95: '39.90', diesel: '38.90' }]
      : [{ id: 22, natural95: '40.90', diesel: '39.90' }]
  );

  await runCheck();

  expect(notifier.sendNotification).toHaveBeenCalledTimes(1);
  const changes = notifier.sendNotification.mock.calls[0][0];
  expect(changes.map((c) => c.slug).sort()).toEqual(['mbenzin-18065', 'tank-ono']);
  expect(changes.find((c) => c.slug === 'tank-ono')).toMatchObject({
    old: { natural95: 39.9, diesel: 38.9 }, new: { natural95: 39.5, diesel: 38.9 },
  });
  expect(db.saveCheck).toHaveBeenCalledTimes(2);
});

test('does not notify when nothing changed', async () => {
  scrapeAll.mockResolvedValue([
    { slug: 'tank-ono', name: 'Tank ONO', source: 'tank_ono', isPrimary: true, natural95: 39.5, diesel: 38.9 },
  ]);
  db.getLatest2ForStation.mockResolvedValue([
    { id: 11, natural95: '39.50', diesel: '38.90' },
    { id: 10, natural95: '39.50', diesel: '38.90' },
  ]);

  await runCheck();

  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(db.deleteRecord).toHaveBeenCalledWith(11); // duplicate unchanged tick cleaned up
  expect(db.saveCheck).toHaveBeenCalledWith(1, { natural95: 39.5, diesel: 38.9 }, false);
});

test('first-ever reading for a station saves but does not notify', async () => {
  scrapeAll.mockResolvedValue([
    { slug: 'mbenzin-99', name: 'New', source: 'mbenzin', isPrimary: false, natural95: 41.0, diesel: 40.0 },
  ]);
  db.getLatest2ForStation.mockResolvedValue([]); // no history
  await runCheck();
  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(db.saveCheck).toHaveBeenCalledWith(2, { natural95: 41.0, diesel: 40.0 }, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/cron.test.js`
Expected: FAIL (current `cron.js` uses the old single-station API / different requires).

- [ ] **Step 3: Rewrite `src/cron.js`**

```js
const cron = require('node-cron');
const { scrapeAll } = require('./scrapers/index');
const db = require('./db');
const { sendNotification } = require('./notifier');

let checking = false;

async function runCheck() {
  if (checking) {
    console.log('Previous check still running, skipping.');
    return;
  }
  checking = true;
  try {
    await _runCheck();
  } finally {
    checking = false;
  }
}

async function _runCheck() {
  const now = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
  console.log('[' + now + '] Running price check...');

  let scraped;
  try {
    scraped = await scrapeAll();
  } catch (err) {
    console.error('scrapeAll error:', err.message);
    return;
  }
  if (!scraped.length) {
    console.error('No stations scraped — skipping.');
    return;
  }

  const changes = [];

  for (const s of scraped) {
    try {
      const stationId = await db.upsertStation(s);
      const [latest, prev] = await db.getLatest2ForStation(stationId);

      const latN = latest ? parseFloat(latest.natural95) : null;
      const latD = latest ? parseFloat(latest.diesel) : null;
      const priceChanged = !latest || latN !== s.natural95 || latD !== s.diesel;

      if (priceChanged) {
        if (latest) {
          changes.push({
            slug: s.slug, name: s.name,
            old: { natural95: latN, diesel: latD },
            new: { natural95: s.natural95, diesel: s.diesel },
          });
        }
        await db.saveCheck(stationId, { natural95: s.natural95, diesel: s.diesel }, true);
      } else {
        const prevSame = prev && parseFloat(prev.natural95) === latN && parseFloat(prev.diesel) === latD;
        if (prevSame) await db.deleteRecord(latest.id);
        await db.saveCheck(stationId, { natural95: s.natural95, diesel: s.diesel }, false);
      }
    } catch (err) {
      console.error('Station ' + s.slug + ' error:', err.message);
    }
  }

  if (changes.length) {
    try {
      await sendNotification(changes);
      console.log('Notified: ' + changes.map((c) => c.name).join(', '));
    } catch (err) {
      console.error('Notification error:', err.message);
    }
  } else {
    console.log('No changes this cycle.');
  }
}

function startCron() {
  cron.schedule('*/5 * * * *', runCheck);
  console.log('Cron started — checking every 5 minutes.');
}

module.exports = { startCron, runCheck };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/cron.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cron.js tests/cron.test.js
git commit -m "feat: multi-station cron loop with batched change detection"
```

---

## Task 8: Digest notification email

**Files:**
- Modify: `src/notifier.js`
- Test: `tests/notifier.test.js` (update)

**Interfaces:**
- Consumes: `changes = Array<{ slug, name, old:{natural95,diesel}, new:{natural95,diesel} }>`, `db.getSubscribers()`.
- Produces:
  - `buildSubject(changes)` → string summarizing the cycle (e.g. `"Dejnyho Hlídač — Tank ONO ↓0,40, VS Petrol ↑0,30"`; falls back to `"změna cen"` when empty).
  - `buildDigestHtml(changes, baseUrl, recipientEmail)` → full HTML email string with one block per changed station.
  - `sendNotification(changes)` — sends to owner + subscribers.

- [ ] **Step 1: Update `tests/notifier.test.js`**

```js
const { buildDigestHtml, buildSubject } = require('../src/notifier');

const changes = [
  { slug: 'tank-ono', name: 'Tank ONO', old: { natural95: 39.9, diesel: 38.9 }, new: { natural95: 39.5, diesel: 38.9 } },
  { slug: 'mbenzin-18065', name: 'VS Petrol', old: { natural95: 40.2, diesel: 39.9 }, new: { natural95: 40.5, diesel: 39.9 } },
];

test('buildSubject summarizes each changed station with direction', () => {
  const subject = buildSubject(changes);
  expect(subject).toContain('Tank ONO');
  expect(subject).toContain('VS Petrol');
  expect(subject).toMatch(/↓\s?0,40/);
  expect(subject).toMatch(/↑\s?0,30/);
});

test('buildSubject falls back when empty', () => {
  expect(buildSubject([])).toContain('změna cen');
});

test('buildDigestHtml renders a block per station and the unsubscribe link', () => {
  const html = buildDigestHtml(changes, 'https://beno.dejny.eu', 'a@b.cz');
  expect(html).toContain('Tank ONO');
  expect(html).toContain('VS Petrol');
  expect(html).toContain('39,50'); // new Tank ONO N95
  expect(html).toContain('/unsubscribe?email=a%40b.cz');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/notifier.test.js`
Expected: FAIL — `buildDigestHtml is not a function` and `buildSubject` signature mismatch.

- [ ] **Step 3: Rewrite `src/notifier.js`**

Keep the existing per-fuel card markup (reuse it inside a station block) and the warm-paper shell. Full new file:

```js
const { Resend } = require('resend');
const db = require('./db');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(date) {
  return date.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fuelDelta(oldV, newV) {
  return Math.round((newV - oldV) * 100) / 100;
}

function buildSubject(changes) {
  if (!changes || !changes.length) return 'Dejnyho Hlídač — změna cen';
  const parts = changes.map((c) => {
    const dn = fuelDelta(c.old.natural95, c.new.natural95);
    const dd = fuelDelta(c.old.diesel, c.new.diesel);
    const biggest = Math.abs(dn) >= Math.abs(dd) ? dn : dd;
    const dir = biggest > 0 ? '↑' : '↓';
    return c.name + ' ' + dir + Math.abs(biggest).toFixed(2).replace('.', ',');
  });
  return 'Dejnyho Hlídač — ' + parts.join(', ');
}

function fuelRow(label, color, oldV, newV) {
  const diff = fuelDelta(oldV, newV);
  const dCol = diff > 0 ? '#991b1b' : diff < 0 ? '#14532d' : '#6b7280';
  const dBg = diff > 0 ? '#fef2f2' : diff < 0 ? '#f0fdf4' : '#f5f5f4';
  const dBorder = diff > 0 ? '#fecaca' : diff < 0 ? '#bbf7d0' : '#e7e5e4';
  const dArrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '—';
  const dStr = diff === 0 ? 'beze změny' : (diff > 0 ? '+' : '') + diff.toFixed(2) + ' Kč';
  return `
    <tr>
      <td style="padding:6px 0">
        <span style="font-family:'SF Mono','Consolas',monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#374151;font-weight:600">${label}</span>
      </td>
      <td style="padding:6px 0;text-align:right">
        ${diff !== 0 ? `<span style="font-family:'SF Mono','Consolas',monospace;font-size:14px;color:#9ca3af;text-decoration:line-through;margin-right:8px">${oldV.toFixed(2)}</span>` : ''}
        <span style="font-family:'SF Mono','Consolas',monospace;font-size:22px;font-weight:700;color:${color}">${newV.toFixed(2)}</span>
        <span style="font-family:'SF Mono','Consolas',monospace;font-size:13px;color:#374151"> Kč</span>
      </td>
      <td style="padding:6px 0 6px 10px;text-align:right">
        <span style="display:inline-block;background:${dBg};border:1px solid ${dBorder};border-radius:999px;padding:3px 10px;font-family:'SF Mono','Consolas',monospace;font-size:11px;font-weight:600;color:${dCol}">${dArrow} ${dStr}</span>
      </td>
    </tr>`;
}

function stationBlock(change) {
  const rows =
    fuelRow('Natural 95', '#166534', change.old.natural95, change.new.natural95) +
    fuelRow('Diesel', '#1e3a8a', change.old.diesel, change.new.diesel);
  return `
    <tr><td style="padding-bottom:12px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #d1d5db;border-radius:12px;border-left:4px solid #b45309" bgcolor="#ffffff">
        <tr><td style="padding:14px 18px 4px 18px">
          <span style="font-size:15px;font-weight:700;color:#111110">${change.name}</span>
        </td></tr>
        <tr><td style="padding:0 18px 10px 18px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
        </td></tr>
      </table>
    </td></tr>`;
}

function buildDigestHtml(changes, baseUrl, recipientEmail) {
  const unsubLink = baseUrl + '/unsubscribe?email=' + encodeURIComponent(recipientEmail);
  const now = formatDate(new Date());
  const blocks = changes.map(stationBlock).join('');

  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" /><title>Dejnyho Hlídač — změna cen</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#111110;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif" bgcolor="#ffffff">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"><tr>
    <td align="center" style="padding:0 16px 56px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
        <tr><td style="height:3px;background:#b45309;border-radius:0 0 3px 3px" bgcolor="#b45309"></td></tr>
        <tr><td style="padding:26px 0 8px">
          <span style="font-size:20px;font-weight:700;color:#111110">Dejnyho Hlídač<span style="color:#b45309">.</span></span>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Změna cen — ${changes.length} ${changes.length === 1 ? 'stanice' : 'stanic'}</div>
        </td></tr>
        <tr><td style="padding:6px 0 16px"><span style="font-family:'SF Mono','Consolas',monospace;font-size:11px;color:#6b7280">${now}</span></td></tr>
        <tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0">${blocks}</table></td></tr>
        <tr><td style="padding-top:6px;padding-bottom:20px">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:#b45309;border-radius:8px" bgcolor="#b45309">
              <a href="${baseUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:13px;font-weight:500;padding:11px 22px">Zobrazit přehled &rarr;</a>
            </td></tr></table>
        </td></tr>
        <tr><td style="border-top:1px solid #dedad4;padding-top:14px">
          <span style="font-size:11px;color:#6b7280;font-family:'SF Mono','Consolas',monospace">${recipientEmail}</span>
          <span style="font-size:11px;color:#9ca3af;margin:0 6px">&middot;</span>
          <a href="${unsubLink}" style="font-size:11px;color:#374151;font-family:'SF Mono','Consolas',monospace;text-decoration:underline">odhlásit</a>
        </td></tr>
      </table>
    </td></tr></table>
</body></html>`;
}

async function sendNotification(changes) {
  const subscribers = await db.getSubscribers();
  const owner = process.env.NOTIFY_EMAIL;
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.error('BASE_URL not set — cannot send notifications');
    return;
  }
  const recipients = [...new Set([owner, ...subscribers])].filter(Boolean);
  const subject = buildSubject(changes);

  for (const email of recipients) {
    try {
      await resend.emails.send({
        from: 'Dejnyho Hlídač <hlidac@dejny.eu>',
        to: email,
        subject,
        html: buildDigestHtml(changes, baseUrl, email),
      });
    } catch (err) {
      console.error('Failed to send email to ' + email + ':', err.message);
    }
  }
}

module.exports = { sendNotification, buildDigestHtml, buildSubject };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/notifier.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notifier.js tests/notifier.test.js
git commit -m "feat: digest notification email for multiple stations"
```

---

## Task 9: API endpoints for leaderboard + station history

**Files:**
- Modify: `src/index.js`
- Modify: `src/db.js` (add one helper: `getStationBySlug`)
- Test: `tests/api.test.js` (create — supertest-style via `app` export; if `supertest` is not desired, unit-test the builder instead — see below)

**Interfaces:**
- Consumes: `db.getStations`, `db.getRecentForStation`, `db.getStationBySlug`, `db.getHistoryForStation`, `leaderboard.computeLastMove`, `leaderboard.rankStations`.
- Produces:
  - `GET /api/stations/latest` → `{ primary: <ranked-station|null>, stations: <ranked top 10> }`, each station: `{ slug, name, is_primary, natural95, diesel, rank, lastMove }`.
  - `GET /api/history?station=<slug>&days=<n>` → history rows for that station (defaults to primary Tank ONO).
  - `buildLeaderboard(stations)` — exported pure helper assembling the ranked payload from per-station `{ ...latest, lastMove }` objects (unit-testable without HTTP).
  - `db.getStationBySlug(slug)` → station row or null.

- [ ] **Step 1: Add `getStationBySlug` to `src/db.js`**

Add this function and include it in `module.exports`:

```js
async function getStationBySlug(slug) {
  const [rows] = await pool.execute('SELECT * FROM stations WHERE slug = ?', [slug]);
  return rows[0] || null;
}
```

- [ ] **Step 2: Write the failing test `tests/api.test.js`**

Unit-test the pure builder (no HTTP, no DB):

```js
const { buildLeaderboard } = require('../src/index');

test('buildLeaderboard ranks, caps at 10, and marks primary', () => {
  const stations = [];
  for (let i = 0; i < 12; i++) {
    stations.push({ slug: 's' + i, name: 'S' + i, is_primary: 0, natural95: 45 - i * 0.1, diesel: 44, lastMove: [] });
  }
  stations.push({ slug: 'tank-ono', name: 'Tank ONO', is_primary: 1, natural95: 39.5, diesel: 38.9, lastMove: [] });

  const { primary, stations: ranked } = buildLeaderboard(stations);
  expect(ranked).toHaveLength(10);
  expect(ranked[0].slug).toBe('tank-ono');
  expect(ranked[0].rank).toBe(1);
  expect(primary.slug).toBe('tank-ono');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/api.test.js`
Expected: FAIL — `buildLeaderboard is not a function`.

- [ ] **Step 4: Update `src/index.js`**

Add the require, the `buildLeaderboard` helper, the two endpoints, and export `buildLeaderboard` alongside `app`. Full new `src/index.js`:

```js
const express = require('express');
const path = require('path');
const db = require('./db');
const { computeLastMove, rankStations } = require('./leaderboard');
const { startCron } = require('./cron');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Pure: assemble ranked leaderboard payload from per-station latest+lastMove objects.
function buildLeaderboard(stations) {
  const ranked = rankStations(stations, 10);
  const primary = ranked.find((s) => s.is_primary) || stations.find((s) => s.is_primary) || null;
  return { primary, stations: ranked };
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

app.post('/api/subscribe', async (req, res) => {
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
```

Note: the old `GET /api/latest` is removed; the frontend switches to `/api/stations/latest`. The `require.main === module` guard lets tests require the module without starting the server/cron.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/api.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.js src/db.js tests/api.test.js
git commit -m "feat: leaderboard + station-history API endpoints"
```

---

## Task 10: Refined frontend — leaderboard section

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/stations/latest` → `{ primary, stations }`; `GET /api/history?station=tank-ono&days=365`.
- Produces: hero cards driven by `primary`; a leaderboard table of `stations` with rank, prices, and a "Poslední posun" cell rendering `lastMove` chips.

- [ ] **Step 1: Add the leaderboard section to `public/index.html`**

Insert this `<section>` between the existing `.prices-section` and `.chart-section`:

```html
    <section class="leaderboard-section">
      <div class="section-header">
        <h2 class="section-title">Žebříček stanic</h2>
        <span class="section-badge" id="lb-city">Ústí nad Labem</span>
      </div>
      <div class="table-wrap">
        <table id="leaderboard-table">
          <thead>
            <tr>
              <th>Stanice</th>
              <th class="num">Natural 95</th>
              <th class="num">Diesel</th>
              <th class="num">Poslední posun</th>
            </tr>
          </thead>
          <tbody id="leaderboard-body"></tbody>
        </table>
      </div>
    </section>
```

- [ ] **Step 2: Add leaderboard styles to `public/style.css`**

Append (reuses existing palette variables):

```css
/* ── Leaderboard ── */
.leaderboard-section { margin-top: 8px; }
#leaderboard-table th.num, #leaderboard-table td.num { text-align: right; }
.lb-rank {
  display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center;
  border-radius: 6px; font-size: .7rem; font-weight: 700; background: var(--surface2);
  color: var(--muted); margin-right: 8px; font-family: 'DM Mono', monospace;
}
#leaderboard-table tr.is-primary { background: #fff7ed; }
#leaderboard-table tr.is-primary .lb-rank { background: var(--live); color: #fff; }
.lb-station { font-weight: 600; }
.lb-price { font-family: 'DM Mono', monospace; }
.lb-move {
  display: inline-flex; align-items: center; gap: 5px; font-family: 'DM Mono', monospace;
  font-size: .72rem; padding: 2px 9px; border-radius: 999px; white-space: nowrap;
}
.lb-move.up   { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; }
.lb-move.down { color: #15803d; background: #f0fdf4; border: 1px solid #bbf7d0; }
.lb-move.flat { color: var(--muted); background: var(--surface2); border: 1px solid var(--border); }
.lb-move .fuel { font-size: .6rem; text-transform: uppercase; letter-spacing: .5px; opacity: .75; }
.lb-moves { display: inline-flex; flex-direction: column; gap: 3px; align-items: flex-end; }
```

- [ ] **Step 3: Add leaderboard rendering to `public/app.js`**

Change `loadLatest()` to use the new endpoint and populate both hero + leaderboard. Replace the existing `loadLatest` function and the two bottom calls:

```js
function fuelLabel(fuel) { return fuel === 'natural95' ? 'N95' : 'Diesel'; }

function relTime(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return 'před ' + mins + ' min';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return 'před ' + hrs + ' h';
  const days = Math.round(hrs / 24);
  return days === 1 ? 'včera' : 'před ' + days + ' dny';
}

function moveCell(lastMove) {
  const td = document.createElement('td');
  td.className = 'num';
  if (!lastMove || !lastMove.length) {
    const flat = document.createElement('span');
    flat.className = 'lb-move flat';
    flat.textContent = 'beze změny';
    td.appendChild(flat);
    return td;
  }
  const wrap = document.createElement('div');
  wrap.className = 'lb-moves';
  lastMove.forEach((m) => {
    const chip = document.createElement('span');
    chip.className = 'lb-move ' + (m.direction === 'up' ? 'up' : 'down');
    const fuel = document.createElement('span');
    fuel.className = 'fuel';
    fuel.textContent = fuelLabel(m.fuel);
    chip.appendChild(fuel);
    chip.appendChild(document.createTextNode(
      ' ' + (m.direction === 'up' ? '▲' : '▼') + ' ' + Math.abs(m.delta).toFixed(2).replace('.', ',')
    ));
    wrap.appendChild(chip);
  });
  const ago = document.createElement('div');
  ago.style.cssText = "font-size:.62rem;color:var(--muted);margin-top:2px";
  ago.textContent = relTime(lastMove[0].at);
  td.appendChild(wrap);
  td.appendChild(ago);
  return td;
}

async function loadLatest() {
  try {
    const res = await fetch('/api/stations/latest');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { primary, stations } = await res.json();

    if (primary) {
      countUp(document.getElementById('price-natural95'), primary.natural95);
      countUp(document.getElementById('price-diesel'), primary.diesel, 1700);
    }

    const tbody = document.getElementById('leaderboard-body');
    tbody.replaceChildren();
    (stations || []).forEach((s) => {
      const tr = document.createElement('tr');
      if (s.is_primary) tr.className = 'is-primary';

      const nameTd = document.createElement('td');
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = s.rank;
      const nm = document.createElement('span');
      nm.className = 'lb-station';
      nm.textContent = s.name;
      nameTd.appendChild(rank);
      nameTd.appendChild(nm);
      tr.appendChild(nameTd);

      const n = document.createElement('td');
      n.className = 'num lb-price';
      n.textContent = s.natural95.toFixed(2);
      tr.appendChild(n);

      const d = document.createElement('td');
      d.className = 'num lb-price';
      d.textContent = s.diesel.toFixed(2);
      tr.appendChild(d);

      tr.appendChild(moveCell(s.lastMove));
      tbody.appendChild(tr);
    });

    if (primary && primary.lastMove && primary.lastMove.length) {
      document.getElementById('last-update').textContent = 'Aktualizováno: ' + relTime(primary.lastMove[0].at);
    }
  } catch (err) {
    console.error('loadLatest:', err);
  }
}
```

The `loadHistory()` function and its `fetch('/api/history?days=365')` call stay as-is (they already target the primary station by default). Keep the existing bottom calls:

```js
loadLatest();
loadHistory();
```

- [ ] **Step 4: Manual verification**

Run: `npm start` (requires DB + `.env`). Open the site. Confirm:
- Hero cards show Tank ONO prices (count-up).
- "Žebříček stanic" lists up to 10 stations, cheapest first, Tank ONO highlighted.
- "Poslední posun" shows chips (or "beze změny") with a relative time.
- Chart + history + subscribe still work.

If no DB is available in the dev environment, verify the DOM wiring by loading `public/index.html` with a stubbed `/api/stations/latest` JSON response.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: leaderboard UI in refined warm design"
```

---

## Task 11: README + full test run

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Update the intro line and add a migration step. Change the first paragraph to:

```markdown
# Hlídač cen Tank ONO

Scrapes Tank ONO official prices plus mbenzin.cz competitor listings for
Ústí nad Labem every 5 minutes. Emails subscribers a single digest when any
tracked station's price changes. Web dashboard with a cheapest-first leaderboard.
```

And under Setup, add after the schema step:

```markdown
4. Run the migration to add the stations table and backfill existing data:
   `node scripts/migrate-multistation.js`
```

- [ ] **Step 2: Run the full test suite**

Run: `npx jest`
Expected: all suites pass (db.test.js requires a test `DATABASE_URL`; skip if unavailable and note it).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for multi-station comparison"
```

---

## Self-Review Notes

- **Spec coverage:** sources (Tasks 3–5), DB + migration (Tasks 1, 6), cron batching (Task 7), digest email (Task 8), API (Task 9), leaderboard UI (Task 10), tests throughout. ✔
- **Scope refinements captured during planning:** two mbenzin pages joined by id (Task 4); both-fuel + top-10 filter (Task 4 `joinFuels`, Task 2 `rankStations`, Task 9 `buildLeaderboard`); multiple Tank ONO rows excluded by name (Task 4). ✔
- **Type consistency:** `scrapeAll()` shape `{slug,name,source,isPrimary,natural95,diesel}` produced in Task 5 and consumed in Task 7; `changes[]` shape produced in Task 7 and consumed in Task 8; `lastMove` array shape produced in Task 2 and consumed in Tasks 9 (`buildLeaderboard`/API) and 10 (`moveCell`). ✔
```
