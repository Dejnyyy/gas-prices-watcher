const fs = require('fs');
const path = require('path');
const { parsePrices } = require('../../src/scrapers/tankOno');

const fixture = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8');

test('picks the "ČS Teplice" row explicitly (Nov 2026 ceník)', () => {
  const p = parsePrices(fixture('cenik-2026-11.html'));
  expect(p).toEqual({ natural95: 37.9, diesel: 42.9, station: 'ČS Teplice' });
});

test('does not just take the first row — a different station name gets its own row', () => {
  const html = `<table class="cenik"><tr><th><img src="../images/ono_logo_cenik.gif"></th>
    <th><img src="../images/n95_c.gif"></th><th><img src="../images/d_c.gif"></th><th><img src="../images/d_plus.gif"></th></tr>
    <tr><td>&nbsp;ČS Plzeň</td><td>36,90</td><td>40,90</td><td>45,00</td></tr>
    <tr><td>&nbsp;ČS Teplice</td><td>37,40</td><td>41,10</td><td>45,00</td></tr></table>`;
  expect(parsePrices(html)).toMatchObject({ natural95: 37.4, diesel: 41.1 });
  expect(parsePrices(html, 'ČS Plzeň')).toMatchObject({ natural95: 36.9, diesel: 40.9 });
});

test('returns null and reports why when Teplice is missing (no silent fallback)', () => {
  const html = `<table class="cenik"><tr><th></th><th><img src="../images/n95_c.gif"></th><th><img src="../images/d_c.gif"></th></tr>
    <tr><td>ČS Plzeň</td><td>36,90</td><td>40,90</td></tr></table>`;
  const why = jest.fn();
  expect(parsePrices(html, 'ČS Teplice', why)).toBeNull();
  expect(why.mock.calls[0][0]).toMatch(/ČS Teplice.*not in ceník.*ČS Plzeň/);
});

test('returns null when Teplice has no diesel price ("---")', () => {
  const html = `<table class="cenik"><tr><th></th><th><img src="../images/n95_c.gif"></th><th><img src="../images/d_c.gif"></th></tr>
    <tr><td>ČS Teplice</td><td>36,90</td><td>---</td></tr></table>`;
  expect(parsePrices(html)).toBeNull();
});

test('older fixture still parses', () => {
  const p = parsePrices(fixture('cenik.html'));
  expect(p.natural95).toBeGreaterThan(20);
  expect(p.diesel).toBeGreaterThan(20);
});

test('parsePrices returns null when HTML structure is unexpected', () => {
  expect(parsePrices('<html><body>no prices here</body></html>')).toBeNull();
});
