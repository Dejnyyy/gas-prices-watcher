// Integration tests — require DATABASE_URL in .env
require('dotenv').config();
const db = require('../src/db');

// SAFETY: Only run against a test database. Never run against production data.
// Set DATABASE_URL to point to tankono_test database before running tests.
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('test')) {
  console.warn('WARNING: DATABASE_URL does not contain "test". Running db tests against this database will DELETE ALL data. Set DATABASE_URL to a test database.');
}

beforeAll(async () => {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  await conn.execute('DELETE FROM price_checks');
  await conn.execute('DELETE FROM subscribers');
  await conn.end();
});

test('saveCheck and getLatest round-trip', async () => {
  const prices = { natural95: 36.10, diesel: 34.50, lpg: 18.20 };
  await db.saveCheck(prices, true);
  const latest = await db.getLatest();
  expect(parseFloat(latest.natural95)).toBeCloseTo(36.10);
  expect(parseFloat(latest.diesel)).toBeCloseTo(34.50);
  expect(parseFloat(latest.lpg)).toBeCloseTo(18.20);
  expect(latest.changed).toBe(1);
});

test('getHistory returns only changed rows', async () => {
  await db.saveCheck({ natural95: 36.10, diesel: 34.50, lpg: 18.20 }, false);
  const history = await db.getHistory(1);
  expect(history.every((r) => r.changed === 1)).toBe(true);
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
