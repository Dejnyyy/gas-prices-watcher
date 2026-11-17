const crypto = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool(process.env.DATABASE_URL);

const DEFAULT_STATIONS = 'tank-ono,makro';
const DEFAULT_FUELS = 'natural95,diesel';

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

function splitList(v, fallback) {
  return String(v || fallback).split(',').map((s) => s.trim()).filter(Boolean);
}

async function upsertStation({ slug, name, location = null, source, isPrimary, sortOrder = 0 }) {
  await pool.execute(
    `INSERT INTO stations (slug, name, location, source, is_primary, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), location = VALUES(location),
       source = VALUES(source), sort_order = VALUES(sort_order)`,
    [slug, name, location, source, isPrimary ? 1 : 0, sortOrder]
  );
  const [[row]] = await pool.query('SELECT id FROM stations WHERE slug = ?', [slug]);
  return row.id;
}

async function getStations({ activeOnly = true } = {}) {
  const [rows] = await pool.query(
    `SELECT id, slug, name, location, source, is_primary, sort_order, is_active FROM stations
     ${activeOnly ? 'WHERE is_active = 1' : ''}
     ORDER BY sort_order, is_primary DESC, name`
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
    'SELECT * FROM price_checks WHERE station_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1',
    [stationId]
  );
  return rows[0] || null;
}

async function getLatest2ForStation(stationId) {
  const [rows] = await pool.execute(
    'SELECT * FROM price_checks WHERE station_id = ? ORDER BY checked_at DESC, id DESC LIMIT 2',
    [stationId]
  );
  return rows; // [newest, second-newest]
}

async function getStationBySlug(slug) {
  const [rows] = await pool.execute('SELECT * FROM stations WHERE slug = ?', [slug]);
  return rows[0] || null;
}

async function getRecentForStation(stationId, limit = 60) {
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 60, 500));
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT * FROM price_checks WHERE station_id = ? ORDER BY checked_at DESC, id DESC LIMIT ?
     ) t ORDER BY checked_at ASC, id ASC`,
    [stationId, lim]
  );
  return rows;
}

// Rows in the window plus the last row before it, so a chart can start at the
// price that was valid when the window opened.
async function getHistoryForStation(stationId, days = 30) {
  const d = Math.max(1, Math.min(parseInt(days, 10) || 30, 730));
  const [rows] = await pool.query(
    `SELECT id, station_id, checked_at, natural95, diesel, changed FROM price_checks
     WHERE station_id = ? AND checked_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY checked_at ASC, id ASC LIMIT 2000`,
    [stationId, d]
  );
  const [before] = await pool.query(
    `SELECT id, station_id, checked_at, natural95, diesel, changed FROM price_checks
     WHERE station_id = ? AND checked_at < DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY checked_at DESC, id DESC LIMIT 1`,
    [stationId, d]
  );
  return before.length ? [before[0], ...rows] : rows;
}

async function deleteRecord(id) {
  await pool.execute('DELETE FROM price_checks WHERE id = ?', [id]);
}

// ── E-mail subscribers ──

function mapSubscriber(r) {
  return {
    id: r.id, email: r.email, token: r.token,
    stations: splitList(r.stations, DEFAULT_STATIONS),
    fuels: splitList(r.fuels, DEFAULT_FUELS),
  };
}

// Returns { created, subscriber }. An existing address keeps its preferences:
// they can only be changed via the tokenised manage link.
async function addSubscriber(email, prefs) {
  const stations = (prefs && prefs.stations ? prefs.stations : splitList(DEFAULT_STATIONS)).join(',');
  const fuels = (prefs && prefs.fuels ? prefs.fuels : splitList(DEFAULT_FUELS)).join(',');
  const [res] = await pool.execute(
    'INSERT IGNORE INTO subscribers (email, token, stations, fuels) VALUES (?, ?, ?, ?)',
    [email, newToken(), stations, fuels]
  );
  const sub = await getSubscriberByEmail(email);
  return { created: res.affectedRows === 1, subscriber: sub };
}

async function getSubscriberByEmail(email) {
  const [rows] = await pool.execute('SELECT * FROM subscribers WHERE email = ?', [email]);
  return rows[0] ? mapSubscriber(rows[0]) : null;
}

async function getSubscriberByToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return null;
  const [rows] = await pool.execute('SELECT * FROM subscribers WHERE token = ?', [token]);
  return rows[0] ? mapSubscriber(rows[0]) : null;
}

async function updateSubscriberPrefs(token, prefs) {
  const [res] = await pool.execute(
    'UPDATE subscribers SET stations = ?, fuels = ? WHERE token = ?',
    [prefs.stations.join(','), prefs.fuels.join(','), token]
  );
  return res.affectedRows > 0;
}

async function removeSubscriberByToken(token) {
  const [res] = await pool.execute('DELETE FROM subscribers WHERE token = ?', [token]);
  return res.affectedRows > 0;
}

async function removeSubscriber(email) {
  await pool.execute('DELETE FROM subscribers WHERE email = ?', [email]);
}

async function getSubscribers() {
  const [rows] = await pool.execute('SELECT * FROM subscribers');
  return rows.map(mapSubscriber);
}

// ── Web Push ──

async function addPushSubscription({ endpoint, p256dh, auth }, prefs) {
  const stations = (prefs ? prefs.stations : splitList(DEFAULT_STATIONS)).join(',');
  const fuels = (prefs ? prefs.fuels : splitList(DEFAULT_FUELS)).join(',');
  await pool.execute(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, stations, fuels) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth),
       stations = VALUES(stations), fuels = VALUES(fuels)`,
    [endpoint, p256dh, auth, stations, fuels]
  );
}

async function getPushSubscription(endpoint) {
  const [rows] = await pool.execute('SELECT * FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  const r = rows[0];
  return r ? { endpoint: r.endpoint, stations: splitList(r.stations, DEFAULT_STATIONS), fuels: splitList(r.fuels, DEFAULT_FUELS) } : null;
}

async function updatePushPrefs(endpoint, prefs) {
  const [res] = await pool.execute(
    'UPDATE push_subscriptions SET stations = ?, fuels = ? WHERE endpoint = ?',
    [prefs.stations.join(','), prefs.fuels.join(','), endpoint]
  );
  return res.affectedRows > 0;
}

async function removePushSubscription(endpoint) {
  await pool.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

async function getPushSubscriptions() {
  const [rows] = await pool.execute('SELECT endpoint, p256dh, auth, stations, fuels FROM push_subscriptions');
  return rows.map((r) => ({
    endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth,
    stations: splitList(r.stations, DEFAULT_STATIONS), fuels: splitList(r.fuels, DEFAULT_FUELS),
  }));
}

module.exports = {
  pool,
  upsertStation, getStations, getStationBySlug,
  saveCheck, getLatestForStation, getLatest2ForStation,
  getRecentForStation, getHistoryForStation, deleteRecord,
  addSubscriber, getSubscriberByEmail, getSubscriberByToken, updateSubscriberPrefs,
  removeSubscriberByToken, removeSubscriber, getSubscribers,
  addPushSubscription, getPushSubscription, updatePushPrefs, removePushSubscription, getPushSubscriptions,
};
