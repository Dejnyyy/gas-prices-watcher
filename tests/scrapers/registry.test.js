jest.mock('../../src/scrapers/tankOno', () => ({ fetchPrices: jest.fn() }));
jest.mock('../../src/scrapers/makro', () => ({ fetchPrices: jest.fn() }));

const tankOno = require('../../src/scrapers/tankOno');
const makro = require('../../src/scrapers/makro');
const { scrapeAll } = require('../../src/scrapers/index');

const quiet = { log: () => {}, logError: () => {} };
beforeEach(() => jest.clearAllMocks());

test('returns exactly the two tracked stations with config metadata', async () => {
  tankOno.fetchPrices.mockResolvedValue({ natural95: 37.9, diesel: 42.9, station: 'ČS Teplice' });
  makro.fetchPrices.mockResolvedValue({ natural95: 37.5, diesel: 42.5, source: 'makro.cz' });
  const all = await scrapeAll(quiet);
  expect(all.map((s) => s.slug)).toEqual(['tank-ono', 'makro']);
  expect(all[0]).toMatchObject({ name: 'Tank ONO', location: 'Teplice', source: 'tank_ono', isPrimary: true, natural95: 37.9, diesel: 42.9 });
  expect(all[1]).toMatchObject({ name: 'Makro', label: 'Makro Trmice', source: 'makro', isPrimary: false, natural95: 37.5 });
});

test('a failing station is skipped, the other is kept', async () => {
  tankOno.fetchPrices.mockRejectedValue(new Error('network'));
  makro.fetchPrices.mockResolvedValue({ natural95: 37.5, diesel: 42.5, source: 'makro.cz' });
  const errs = [];
  const all = await scrapeAll({ log: () => {}, logError: (m) => errs.push(m) });
  expect(all.map((s) => s.slug)).toEqual(['makro']);
  expect(errs.join('\n')).toMatch(/tank-ono: network/);
});

test('returns [] when both fail', async () => {
  tankOno.fetchPrices.mockResolvedValue(null);
  makro.fetchPrices.mockResolvedValue(null);
  expect(await scrapeAll(quiet)).toEqual([]);
});
