# Design: Dejnyho Hlídač — Multi-Station Comparison + Refined Design

**Date:** 2026-07-26
**Status:** Approved (brainstorming complete)

## Summary

Extend the Tank ONO price watcher from a single-source tracker into a
**multi-station price comparison** for Ústí nad Labem, and refine the existing
warm-paper web design to present it. The dashboard gains a leaderboard ranking
all local stations cheapest-first, each showing its most recent price move.

## Goals

- Track competitor fuel prices alongside Tank ONO's own.
- Show, at a glance, where fuel is cheapest in town right now.
- Keep the existing warm-paper visual identity; evolve, don't replace it.
- Notify subscribers of any station's price change (batched into one digest per cycle).

## Non-Goals (YAGNI)

- No headless-browser / proxy scraping (rules out Makro — hard 403 bot-wall).
- No per-station chart selector in v1 (chart stays Tank ONO; easy to add later).
- No new cities in v1 (single city: `usti-nad-labem`). Structure allows adding later.
- No user accounts, no per-user station preferences.

## Data Sources

| Source | URL | Yields | Notes |
|--------|-----|--------|-------|
| Tank ONO official | `tank-ono.cz/cz/index.php?page=cenik` | Tank ONO N95 + Diesel | Existing scraper, authoritative for Tank ONO. Unchanged. |
| mbenzin.cz city listing | `mbenzin.cz/Nejlevnejsi-benzin/usti-nad-labem` | ~9 Ústí stations, actual N95 + Nafta prices | One fetch, one scraper. Actual crowd-sourced current prices with freshness date. |
| ~~Makro~~ | ~~`makro.cz/prodejny/usti-nad-labem`~~ | — | **Dropped.** HTTP 403 hard bot-wall even with full browser headers. |

**Important nuance discovered:** mbenzin *single-station* pages prominently show
the state-regulated **maximum** price ("Státem regulovaná maximální cena"), not
the actual price. The **city listing** page (`Nejlevnejsi-benzin/...`) is the one
that shows real current prices per station — that is the source we use.

## Architecture

### Database

New `stations` table:

```sql
CREATE TABLE IF NOT EXISTS stations (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(64)  NOT NULL UNIQUE,   -- e.g. 'tank-ono', 'vs-petrol'
  name       VARCHAR(128) NOT NULL,          -- display name
  source     ENUM('tank_ono','mbenzin') NOT NULL,
  is_primary TINYINT(1)   NOT NULL DEFAULT 0, -- Tank ONO = 1
  sort_order INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`price_checks` gains a station FK; existing columns kept:

```sql
ALTER TABLE price_checks
  ADD COLUMN station_id INT UNSIGNED NULL AFTER id,
  ADD INDEX idx_station_time (station_id, checked_at);
-- FK added after backfill.
```

**Migration steps:**
1. Create `stations`.
2. Insert Tank ONO row (`slug='tank-ono', source='tank_ono', is_primary=1`).
3. Backfill: `UPDATE price_checks SET station_id = <tankOnoId> WHERE station_id IS NULL`.
4. Make `station_id` NOT NULL, add FK.
5. mbenzin stations are upserted on first scrape (by slug derived from name).

### Scrapers

- `src/scrapers/tankOno.js` — today's `src/scraper.js` parsing logic, moved verbatim.
  Returns `{ natural95, diesel } | null`.
- `src/scrapers/mbenzin.js` — fetches the city listing, parses each station row into
  `{ name, natural95, diesel }`. Skips rows with missing/`0` prices. Returns an array.
- `src/scrapers/index.js` — `scrapeAll()` runs both, resolves each result to a station
  row (creating mbenzin stations on first sight), returns
  `[{ stationId, natural95, diesel }]`.

Station identity for mbenzin: `slug = slugify(name)`. Tank ONO's mbenzin-reported
price maps to the **existing** Tank ONO station only if we choose to; v1 keeps the
official Tank ONO price as the primary and lets mbenzin's Tank ONO row map to the
same station (official scrape wins when both run — official is saved last / marked
authoritative). *Decision:* official Tank ONO value is the one displayed for the
primary station; mbenzin's Tank ONO row is ignored to avoid a duplicate.

### Cron + Notifications

Per 5-minute cycle (`src/cron.js`):
1. `scrapeAll()`.
2. For each station: compare to its latest saved row (per-station), save a tick,
   apply the existing duplicate-tick cleanup **scoped per station**.
3. Collect every station whose price changed this cycle.
4. If any changed → send **one digest email** to all recipients listing each changed
   station with old→new per fuel and the delta. Batching satisfies "email on any
   station change" without one-email-per-station spam.

Concurrency guard (`checking` flag) stays.

### Notifier

`src/notifier.js` rebuilds the email as a **digest**:
- Header + timestamp (kept, warm-paper style).
- One block per changed station: station name, N95 and Diesel old→new with coloured
  delta chips (reuse existing chip styling).
- CTA + unsubscribe footer (kept).

`buildSubject` summarizes across stations (e.g. "Tank ONO ↓0,40, VS Petrol ↑0,30").

### API (`src/index.js` + `src/db.js`)

- `GET /api/stations/latest` — array, one entry per station:
  `{ slug, name, is_primary, natural95, diesel, rank, lastMove: { fuel, delta, direction, at } | null }`.
  Rank = ascending by a chosen fuel (Natural 95 primary; ties broken by Diesel).
  `lastMove` computed from that station's history (most recent row where a price
  differs from the prior row). If both fuels moved in that check, include **both**
  (stacked in UI).
- `GET /api/history?station=<slug>&days=<n>` — history for the chart; defaults to
  the primary (Tank ONO) station. Same shape as today.
- `GET /api/latest` — kept for back-compat (primary station latest).
- `POST /api/subscribe`, `GET /unsubscribe` — unchanged.

### Frontend (Layout A, refined warm look)

`public/index.html`, `public/app.js`, `public/style.css`:

- **Hero** — Tank ONO Natural 95 + Diesel cards (kept, count-up animation kept).
- **Leaderboard** — new section: all stations ranked cheapest-first. Columns:
  Stanice (rank badge + name; Tank ONO row highlighted), Natural 95, Diesel,
  **Poslední posun** (chip: fuel label + arrow + amount, green=drop/red=rise,
  plus muted "před 2 h" relative time; "beze změny" state when none). Both-fuel
  moves stack.
- **Chart** — kept, Tank ONO Natural 95 + Diesel over time.
- **History** — kept (primary station).
- **Subscribe** — kept.

## Testing

- Jest unit tests with saved HTML fixtures:
  - `tankOno.js` parser against a Tank ONO ceník fixture (port existing coverage).
  - `mbenzin.js` parser against a saved city-listing fixture → asserts station count,
    names, and N95/Diesel values; asserts rows with missing prices are skipped.
- Unit test for rank + `lastMove` computation from a synthetic history.
- Keep existing test structure under `tests/`.

## Rollout

1. Schema migration (additive; backfill; safe on live DB).
2. Ship scrapers + cron behind the same 5-min schedule.
3. Deploy via existing Docker / pm2 flow. No env changes required.

## Open Questions (resolved)

- **Sources:** Official Tank ONO + mbenzin listing. ✔
- **Notifications:** any station change, batched into one digest per cycle. ✔
- **Design direction:** refine current warm look. ✔
- **Layout:** A (leaderboard) with "last move" column replacing distance. ✔
- **Both fuels change in one check:** stack both moves. ✔
- **Timestamp in last-move column:** keep relative "před 2 h". ✔
