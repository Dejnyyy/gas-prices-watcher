# Hlídač cen Tank ONO

Scrapes Tank ONO official prices plus mbenzin.cz competitor listings for Ústí nad Labem every 5 minutes. Emails subscribers a single digest when any tracked station's price changes. Web dashboard with a cheapest-first leaderboard.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in values
3. Run SQL from `schema.sql` to create the database tables
4. Run the migration to add the stations table and backfill existing data: `node scripts/migrate-multistation.js`
5. `npm start`

## Deployment Notes

- Deploy the app code and run `node scripts/migrate-multistation.js` together — the migration makes `price_checks.station_id` NOT NULL, so the new cron (which supplies `station_id`) must be live at the same time.
- `tests/db.test.js` is destructive (it clears tables) and refuses to run unless `DATABASE_URL` points at a database whose name contains `test`. Run the rest with `npx jest --testPathIgnorePatterns=db.test`.

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
