// v3: the watcher tracks only Tank ONO Teplice. Idempotent — safe to run repeatedly.
//
//   node scripts/migrate-v3-ono-only.js
//
// - stations: every station other than tank-ono is marked inactive
//   (price history is kept, nothing is deleted).
// - subscribers + push_subscriptions: everyone follows tank-ono (their fuel
//   choice is kept); column defaults become 'tank-ono'.
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  console.log('Migrating database:', db);

  await conn.execute(
    `INSERT INTO stations (slug, name, location, source, is_primary, is_active, sort_order)
     VALUES ('tank-ono', 'Tank ONO', 'Teplice', 'tank_ono', 1, 1, 0)
     ON DUPLICATE KEY UPDATE is_primary = 1, is_active = 1, sort_order = 0`
  );
  const [deact] = await conn.execute(
    `UPDATE stations SET is_active = 0, is_primary = 0 WHERE slug <> 'tank-ono' AND is_active = 1`
  );
  console.log('Stations deactivated:', deact.affectedRows);

  for (const table of ['subscribers', 'push_subscriptions']) {
    await conn.execute(`ALTER TABLE ${table} ALTER COLUMN stations SET DEFAULT 'tank-ono'`);
    const [r] = await conn.execute(`UPDATE ${table} SET stations = 'tank-ono' WHERE stations <> 'tank-ono'`);
    console.log(`${table}: switched to tank-ono:`, r.affectedRows);
  }

  const [stations] = await conn.query('SELECT id, slug, name, is_primary, is_active FROM stations ORDER BY id');
  console.table(stations);
  const [[subs]] = await conn.query(
    `SELECT COUNT(*) AS n, SUM(stations = 'tank-ono') AS ono FROM subscribers`
  );
  const [[pushes]] = await conn.query(
    `SELECT COUNT(*) AS n, SUM(stations = 'tank-ono') AS ono FROM push_subscriptions`
  );
  console.log('Subscribers:', subs, 'Push:', pushes);
  console.log('Migration v3 complete.');
  await conn.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
