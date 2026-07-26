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

async function constraintExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS c FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
    [table, name]
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
  if (!(await constraintExists(conn, 'price_checks', 'fk_price_checks_station'))) {
    await conn.execute(
      `ALTER TABLE price_checks
       ADD CONSTRAINT fk_price_checks_station FOREIGN KEY (station_id) REFERENCES stations(id)`
    );
  }

  console.log('Migration complete. Tank ONO station id =', tankOnoId);
  await conn.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
