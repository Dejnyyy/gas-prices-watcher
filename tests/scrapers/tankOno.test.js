const fs = require('fs');
const path = require('path');
const { parsePrices } = require('../../src/scrapers/tankOno');

test('parsePrices extracts Natural 95 and Diesel from fixture HTML', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'cenik.html'),
    'utf8'
  );
  const prices = parsePrices(html);
  expect(typeof prices.natural95).toBe('number');
  expect(typeof prices.diesel).toBe('number');
  expect(prices.natural95).toBeGreaterThan(20);
  expect(prices.diesel).toBeGreaterThan(20);
});

test('parsePrices returns null when HTML structure is unexpected', () => {
  const prices = parsePrices('<html><body>no prices here</body></html>');
  expect(prices).toBeNull();
});
