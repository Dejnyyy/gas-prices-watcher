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
