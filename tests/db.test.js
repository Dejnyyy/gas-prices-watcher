require('dotenv').config();
const db = require('../src/db');

let stationId;

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('test')) {
    throw new Error('Refusing to run destructive db tests: DATABASE_URL must point at a database whose name contains "test".');
  }

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

test('addSubscriber and getSubscribers', async () => {
  await db.addSubscriber('test@example.com');
  const subs = await db.getSubscribers();
  expect(subs).toContain('test@example.com');
});

test('addSubscriber ignores duplicate email', async () => {
  await db.addSubscriber('test@example.com');
  const subs = await db.getSubscribers();
  expect(subs.filter((e) => e === 'test@example.com').length).toBe(1);
});

test('removeSubscriber deletes by email', async () => {
  await db.removeSubscriber('test@example.com');
  const subs = await db.getSubscribers();
  expect(subs).not.toContain('test@example.com');
});
