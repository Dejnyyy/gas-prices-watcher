jest.mock('../src/scrapers/index', () => ({ scrapeAll: jest.fn() }));
jest.mock('../src/notifier', () => ({ sendNotification: jest.fn() }));
jest.mock('../src/db', () => ({
  upsertStation: jest.fn(),
  getLatest2ForStation: jest.fn(),
  saveCheck: jest.fn(),
  deleteRecord: jest.fn(),
}));

const { scrapeAll } = require('../src/scrapers/index');
const db = require('../src/db');
const notifier = require('../src/notifier');
const { runCheck } = require('../src/cron');

beforeEach(() => {
  jest.clearAllMocks();
  db.upsertStation.mockImplementation(async (s) => (s.slug === 'tank-ono' ? 1 : 2));
});

test('batches all changed stations into a single notification', async () => {
  scrapeAll.mockResolvedValue([
    { slug: 'tank-ono', name: 'Tank ONO', source: 'tank_ono', isPrimary: true, natural95: 39.5, diesel: 38.9 },
    { slug: 'mbenzin-18065', name: 'VS Petrol', source: 'mbenzin', isPrimary: false, natural95: 40.5, diesel: 39.9 },
  ]);
  // Both stations have a prior, different reading -> both changed.
  db.getLatest2ForStation.mockImplementation(async (id) =>
    id === 1
      ? [{ id: 11, natural95: '39.90', diesel: '38.90' }]
      : [{ id: 22, natural95: '40.90', diesel: '39.90' }]
  );

  await runCheck();

  expect(notifier.sendNotification).toHaveBeenCalledTimes(1);
  const changes = notifier.sendNotification.mock.calls[0][0];
  expect(changes.map((c) => c.slug).sort()).toEqual(['mbenzin-18065', 'tank-ono']);
  expect(changes.find((c) => c.slug === 'tank-ono')).toMatchObject({
    old: { natural95: 39.9, diesel: 38.9 }, new: { natural95: 39.5, diesel: 38.9 },
  });
  expect(db.saveCheck).toHaveBeenCalledTimes(2);
});

test('does not notify when nothing changed', async () => {
  scrapeAll.mockResolvedValue([
    { slug: 'tank-ono', name: 'Tank ONO', source: 'tank_ono', isPrimary: true, natural95: 39.5, diesel: 38.9 },
  ]);
  db.getLatest2ForStation.mockResolvedValue([
    { id: 11, natural95: '39.50', diesel: '38.90' },
    { id: 10, natural95: '39.50', diesel: '38.90' },
  ]);

  await runCheck();

  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(db.deleteRecord).toHaveBeenCalledWith(11); // duplicate unchanged tick cleaned up
  expect(db.saveCheck).toHaveBeenCalledWith(1, { natural95: 39.5, diesel: 38.9 }, false);
});

test('first-ever reading for a station saves but does not notify', async () => {
  scrapeAll.mockResolvedValue([
    { slug: 'mbenzin-99', name: 'New', source: 'mbenzin', isPrimary: false, natural95: 41.0, diesel: 40.0 },
  ]);
  db.getLatest2ForStation.mockResolvedValue([]); // no history
  await runCheck();
  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(db.saveCheck).toHaveBeenCalledWith(2, { natural95: 41.0, diesel: 40.0 }, true);
});
