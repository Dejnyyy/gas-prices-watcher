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

test('addSubscriber stores prefs + token, getSubscribers returns them', async () => {
  const { created, subscriber } = await db.addSubscriber('test@example.com', { stations: ['makro'], fuels: ['diesel'] });
  expect(created).toBe(true);
  expect(subscriber.token).toMatch(/^[a-f0-9]{32}$/);
  const subs = await db.getSubscribers();
  expect(subs.find((s) => s.email === 'test@example.com')).toMatchObject({ stations: ['makro'], fuels: ['diesel'] });
});

test('addSubscriber ignores duplicate email and keeps prefs', async () => {
  const { created } = await db.addSubscriber('test@example.com', { stations: ['tank-ono'], fuels: ['natural95'] });
  expect(created).toBe(false);
  const subs = (await db.getSubscribers()).filter((s) => s.email === 'test@example.com');
  expect(subs).toHaveLength(1);
  expect(subs[0].stations).toEqual(['makro']);
});

test('prefs update + removal by token', async () => {
  const sub = await db.getSubscriberByEmail('test@example.com');
  expect(await db.updateSubscriberPrefs(sub.token, { stations: ['tank-ono', 'makro'], fuels: ['natural95'] })).toBe(true);
  expect((await db.getSubscriberByToken(sub.token)).fuels).toEqual(['natural95']);
  await db.removeSubscriberByToken(sub.token);
  expect(await db.getSubscriberByEmail('test@example.com')).toBeNull();
});
