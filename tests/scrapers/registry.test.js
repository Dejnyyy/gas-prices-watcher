jest.mock('../../src/scrapers/tankOno', () => ({ fetchPrices: jest.fn() }));

const tankOno = require('../../src/scrapers/tankOno');
const { scrapeAll } = require('../../src/scrapers/index');

const quiet = { log: () => {}, logError: () => {} };
beforeEach(() => jest.clearAllMocks());

test('returns Tank ONO with config metadata', async () => {
  tankOno.fetchPrices.mockResolvedValue({ natural95: 37.9, diesel: 42.9, station: 'ČS Teplice' });
  const all = await scrapeAll(quiet);
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ slug: 'tank-ono', name: 'Tank ONO', location: 'Teplice', source: 'tank_ono', isPrimary: true, natural95: 37.9, diesel: 42.9 });
});

test('a failing scrape is logged and yields []', async () => {
  tankOno.fetchPrices.mockRejectedValue(new Error('network'));
  const errs = [];
  expect(await scrapeAll({ log: () => {}, logError: (m) => errs.push(m) })).toEqual([]);
  expect(errs.join('\n')).toMatch(/tank-ono: network/);
});

test('returns [] when the Teplice row is missing', async () => {
  tankOno.fetchPrices.mockResolvedValue(null);
  expect(await scrapeAll(quiet)).toEqual([]);
});
