const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool(process.env.DATABASE_URL);

async function saveCheck(prices, changed) {
  await pool.execute(
    'INSERT INTO price_checks (checked_at, natural95, diesel, changed) VALUES (NOW(), ?, ?, ?)',
    [prices.natural95, prices.diesel, changed ? 1 : 0]
  );
}

async function getLatest() {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks ORDER BY checked_at DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function getLatest2() {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks ORDER BY checked_at DESC LIMIT 2'
  );
  return rows; // [newest, second-newest]
}

async function deleteRecord(id) {
  await pool.execute('DELETE FROM price_checks WHERE id = ?', [id]);
}

async function getHistory(days = 30) {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks WHERE checked_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY checked_at ASC LIMIT 300',
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

module.exports = { saveCheck, getLatest, getLatest2, deleteRecord, getHistory, addSubscriber, removeSubscriber, getSubscribers };
