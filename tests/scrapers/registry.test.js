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

test('combines Tank ONO (primary) with only allow-listed mbenzin brands', async () => {
  tankOno.fetchPrices.mockResolvedValue({ natural95: 39.5, diesel: 38.9 });
  mbenzin.fetchStations.mockResolvedValue([
    { id: '18065', name: 'VS Petrol', natural95: 40.5, diesel: 39.9 }, // not allow-listed
    { id: '17681', name: 'Makro', natural95: 41.5, diesel: 42.5 },
    { id: '16871', name: 'EuroOil', natural95: 41.5, diesel: 41.9 },
  ]);
  const all = await scrapeAll();
  expect(all[0]).toMatchObject({ slug: 'tank-ono', source: 'tank_ono', isPrimary: true, natural95: 39.5, diesel: 38.9 });
  const slugs = all.map((s) => s.slug);
  expect(slugs).toEqual(['tank-ono', 'makro', 'eurooil']);
  expect(slugs).not.toContain('mbenzin-18065');
});

test('collapses multiple EuroOil locations to the cheapest (Natural95, diesel tie-break)', async () => {
  tankOno.fetchPrices.mockResolvedValue(null);
  mbenzin.fetchStations.mockResolvedValue([
    { id: '17008', name: 'EuroOil', natural95: 41.9, diesel: 42.5 },
    { id: '16871', name: 'EuroOil', natural95: 41.5, diesel: 41.9 }, // cheapest N95
    { id: '17009', name: 'EuroOil', natural95: 41.9, diesel: 39.2 },
  ]);
  const all = await scrapeAll();
  const eurooil = all.filter((s) => s.slug === 'eurooil');
  expect(eurooil).toHaveLength(1);
  expect(eurooil[0]).toMatchObject({ slug: 'eurooil', name: 'EuroOil', natural95: 41.5, diesel: 41.9 });
});

test('skips a scraper that fails, keeps the other', async () => {
  tankOno.fetchPrices.mockResolvedValue(null);
  mbenzin.fetchStations.mockRejectedValue(new Error('network'));
  const all = await scrapeAll();
  expect(all).toEqual([]);
});
