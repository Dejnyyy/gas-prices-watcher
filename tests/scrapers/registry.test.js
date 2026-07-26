jest.mock('../../src/scrapers/tankOno', () => ({
  fetchPrices: jest.fn(),
  KEY: 'tank-ono',
}));
jest.mock('../../src/scrapers/mbenzin', () => ({
  fetchStations: jest.fn(),
}));

const tankOno = require('../../src/scrapers/tankOno');
const mbenzin = require('../../src/scrapers/mbenzin');
const { scrapeAll } = require('../../src/scrapers/index');

beforeEach(() => jest.clearAllMocks());

test('combines Tank ONO (primary) and mbenzin stations', async () => {
  tankOno.fetchPrices.mockResolvedValue({ natural95: 39.5, diesel: 38.9 });
  mbenzin.fetchStations.mockResolvedValue([
    { id: '18065', name: 'VS Petrol', natural95: 40.5, diesel: 39.9 },
  ]);
  const all = await scrapeAll();
  expect(all[0]).toMatchObject({ slug: 'tank-ono', source: 'tank_ono', isPrimary: true, natural95: 39.5, diesel: 38.9 });
  expect(all[1]).toMatchObject({ slug: 'mbenzin-18065', name: 'VS Petrol', source: 'mbenzin', isPrimary: false, natural95: 40.5 });
});

test('skips a scraper that fails, keeps the other', async () => {
  tankOno.fetchPrices.mockResolvedValue(null);
  mbenzin.fetchStations.mockRejectedValue(new Error('network'));
  const all = await scrapeAll();
  expect(all).toEqual([]);
});
