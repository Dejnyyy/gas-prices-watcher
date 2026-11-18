# Dejnyho Hlídač (beno.dejny.eu)

Watches Natural 95 and diesel prices at **Tank ONO – ČS Teplice**, every 5 minutes.
Source: the `tank-ono.cz` ceník, row matched by name (`TANK_ONO_STATION`, default
`ČS Teplice`). Missing row ⇒ logged, no data saved (no silent fallback to another station).

Every change is stored; subscribers get one e-mail / push per run containing only the
fuels they chose (Natural 95, nafta or both). The headline (subject, push title) is the
change itself, e.g. `Tank ONO Teplice: Natural 95 ↓ 37,90 Kč (−0,60)`.

Makro Trmice was tracked until Nov 2026; it is marked inactive in the DB (history kept)
by `node scripts/migrate-v3-ono-only.js`, which also switches every subscriber to Tank ONO.

A price read off the official site can be recorded by hand (no notification is sent):
`node scripts/set-price.js tank-ono 37.90 42.90`.

Two consecutive checks more than 48 h apart are an observation gap: a price difference
across it has no known date, so it is not shown as the last change, not listed in the
change table, not notified, and the chart line is broken there.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in values
3. Create tables from `schema.sql` (fresh DB) **or** migrate an existing one:
   `node scripts/migrate-v2-prefs.js` then `node scripts/migrate-v3-ono-only.js` (both idempotent; history is kept)
4. `npm start`

## Tests

`npx jest --testPathIgnorePatterns=db.test`

`tests/db.test.js` is destructive and refuses to run unless `DATABASE_URL` points at a
database whose name contains `test`. **The local `.env` points at production — never run
the app (`npm start` starts the cron and sends e-mails) or db tests against it.**

## API

- `GET /api/stations/latest` – Tank ONO: prices, `checked_at`, last move per fuel
- `GET /api/history?station=tank-ono&days=1..730` (`station=all` → `{ "tank-ono": rows }`)
- `POST /api/subscribe` `{ email, fuels[] }` – always `{ ok: true }`; an existing address keeps its prefs
- `GET|POST /api/subscription` `{ token, fuels[] }` – manage page (`/manage.html?token=…`, linked in every e-mail)
- `POST /api/unsubscribe` `{ token }`, `GET /unsubscribe?token=` (confirm page), `POST /unsubscribe?token=` (RFC 8058 one-click)
- `POST /api/push/subscribe` `{ subscription, fuels[] }`, `/api/push/status`, `/api/push/prefs`, `/api/push/unsubscribe`

Station: `tank-ono` (a `stations` field from old clients is ignored). Fuels: `natural95`, `diesel`.

## Scripts

- `scripts/migrate-v2-prefs.js` – v2 schema migration (idempotent)
- `scripts/migrate-v3-ono-only.js` – Makro inactive, all subscribers on Tank ONO (idempotent)
- `scripts/send-test-email.js [--dry]` – one sample e-mail to `NOTIFY_EMAIL` only
- `scripts/set-price.js <slug> <n95> <diesel>` – record a manually verified price

## Production (VPS)

Docker compose service `app` in `~/gas-prices-watcher` (host port 3005, nginx `beno.dejny.eu`).
The VPS has no GitHub access — deploy with a bundle:

    git bundle create /tmp/beno.bundle main
    scp /tmp/beno.bundle ubuntu@dejnyhoserver.bagros.eu:/tmp/
    # on the VPS (keeps the local "3005:3000" port edit in docker-compose.yml)
    cd ~/gas-prices-watcher && git stash && git pull /tmp/beno.bundle main && git stash pop
    sudo docker compose up -d --build
    sudo docker compose exec app node scripts/migrate-v2-prefs.js   # once, after a DB backup

Bump `VERSION` in `public/sw.js` and the `?v=` asset query on frontend changes.
