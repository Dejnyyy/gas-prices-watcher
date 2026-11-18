// v2: two tracked stations (Tank ONO + Makro Trmice) and per-subscriber
// station/fuel preferences. Idempotent — safe to run repeatedly.
//
//   node scripts/migrate-v2-prefs.js
//
// - stations: +is_active, +location, source ENUM -> VARCHAR(32); anything other
//   than tank-ono/makro is marked inactive (history is kept, never deleted).
// - subscribers: +token (unique, backfilled), +stations, +fuels (existing rows
//   default to both stations + both fuels).
// - push_subscriptions: +stations, +fuels (same defaults).
require('dotenv').config();
const crypto = require('crypto');
const mysql = require('mysql2/promise');

async function columnInfo(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT DATA_TYPE AS t FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows[0] || null;
}

async function indexExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, name]
  );
  return rows[0].c > 0;
}

async function addColumn(conn, table, column, ddl) {
  if (await columnInfo(conn, table, column)) return false;
  await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`+ ${table}.${column}`);
  return true;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  console.log('Migrating database:', db);

  // ── stations ──
  await addColumn(conn, 'stations', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER is_primary');
  await addColumn(conn, 'stations', 'location', 'VARCHAR(128) NULL AFTER name');
  const src = await columnInfo(conn, 'stations', 'source');
  if (src && src.t === 'enum') {
    await conn.execute(`ALTER TABLE stations MODIFY source VARCHAR(32) NOT NULL`);
    console.log('~ stations.source -> VARCHAR(32)');
  }
  await conn.execute(
    `INSERT INTO stations (slug, name, location, source, is_primary, is_active, sort_order)
     VALUES ('tank-ono', 'Tank ONO', 'Teplice', 'tank_ono', 1, 1, 0)
     ON DUPLICATE KEY UPDATE name = VALUES(name), location = VALUES(location), source = VALUES(source),
       is_primary = 1, is_active = 1, sort_order = 0`
  );
  await conn.execute(
    `INSERT INTO stations (slug, name, location, source, is_primary, is_active, sort_order)
     VALUES ('makro', 'Makro', 'Ústí n. L. – Trmice', 'makro', 0, 1, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), location = VALUES(location), source = VALUES(source),
       is_primary = 0, is_active = 1, sort_order = 1`
  );
  const [deact] = await conn.execute(
    `UPDATE stations SET is_active = 0 WHERE slug NOT IN ('tank-ono', 'makro') AND is_active = 1`
  );
  console.log('Stations deactivated:', deact.affectedRows);

  // ── subscribers ──
  await addColumn(conn, 'subscribers', 'token', 'CHAR(32) NULL AFTER email');
  await addColumn(conn, 'subscribers', 'stations', `VARCHAR(64) NOT NULL DEFAULT 'tank-ono,makro'`);
  await addColumn(conn, 'subscribers', 'fuels', `VARCHAR(64) NOT NULL DEFAULT 'natural95,diesel'`);
  const [noToken] = await conn.query('SELECT id FROM subscribers WHERE token IS NULL');
  for (const r of noToken) {
    await conn.execute('UPDATE subscribers SET token = ? WHERE id = ?', [crypto.randomBytes(16).toString('hex'), r.id]);
  }
  console.log('Subscriber tokens backfilled:', noToken.length);
  if (!(await indexExists(conn, 'subscribers', 'uq_subscribers_token'))) {
    await conn.execute('ALTER TABLE subscribers ADD UNIQUE INDEX uq_subscribers_token (token)');
    console.log('+ subscribers.uq_subscribers_token');
  }

  // ── push_subscriptions ──
  await addColumn(conn, 'push_subscriptions', 'stations', `VARCHAR(64) NOT NULL DEFAULT 'tank-ono,makro'`);
  await addColumn(conn, 'push_subscriptions', 'fuels', `VARCHAR(64) NOT NULL DEFAULT 'natural95,diesel'`);

  const [stations] = await conn.query('SELECT id, slug, name, location, source, is_active FROM stations ORDER BY id');
  console.table(stations);
  const [[subs]] = await conn.query('SELECT COUNT(*) AS n, SUM(token IS NOT NULL) AS with_token FROM subscribers');
  console.log('Subscribers:', subs);
  console.log('Migration v2 complete.');
  await conn.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
