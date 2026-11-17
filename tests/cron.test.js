jest.mock('../src/scrapers/index', () => ({ scrapeAll: jest.fn() }));
jest.mock('../src/notifier', () => ({ sendNotification: jest.fn() }));
jest.mock('../src/push', () => ({ sendPriceChangePush: jest.fn() }));
jest.mock('../src/db', () => ({
  upsertStation: jest.fn(),
  getLatest2ForStation: jest.fn(),
  saveCheck: jest.fn(),
  deleteRecord: jest.fn(),
  getStationBySlug: jest.fn(),
  getLatestForStation: jest.fn(),
}));

const { scrapeAll } = require('../src/scrapers/index');
const db = require('../src/db');
const notifier = require('../src/notifier');
const push = require('../src/push');
const { runCheck } = require('../src/cron');

const ONO = { slug: 'tank-ono', name: 'Tank ONO', label: 'Tank ONO Teplice', source: 'tank_ono', isPrimary: true };
const MAKRO = { slug: 'makro', name: 'Makro', label: 'Makro Trmice', source: 'makro', isPrimary: false };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  db.upsertStation.mockImplementation(async (s) => (s.slug === 'tank-ono' ? 1 : 2));
  notifier.sendNotification.mockResolvedValue({ sent: 1, skipped: 0 });
  push.sendPriceChangePush.mockResolvedValue({ sent: 1, pruned: 0, skipped: 0 });
});

test('batches both changed stations into one notification run, with current prices', async () => {
  scrapeAll.mockResolvedValue([
    { ...ONO, natural95: 37.9, diesel: 42.9 },
    { ...MAKRO, natural95: 37.5, diesel: 42.5 },
  ]);
  db.getLatest2ForStation.mockImplementation(async (id) =>
    id === 1 ? [{ id: 11, natural95: '38.50', diesel: '42.90' }] : [{ id: 22, natural95: '37.50', diesel: '42.90' }]
  );

  await runCheck();

  expect(notifier.sendNotification).toHaveBeenCalledTimes(1);
  const [changes, opts] = notifier.sendNotification.mock.calls[0];
  expect(changes.map((c) => c.slug)).toEqual(['tank-ono', 'makro']);
  expect(changes[0]).toMatchObject({ old: { natural95: 38.5, diesel: 42.9 }, new: { natural95: 37.9, diesel: 42.9 } });
  expect(opts.latest).toEqual({ 'tank-ono': { natural95: 37.9, diesel: 42.9 }, makro: { natural95: 37.5, diesel: 42.5 } });
  expect(push.sendPriceChangePush).toHaveBeenCalledWith(changes, { latest: opts.latest });
  expect(db.saveCheck).toHaveBeenCalledTimes(2);
});

test('fills current price of a station that failed to scrape from the DB', async () => {
  scrapeAll.mockResolvedValue([{ ...ONO, natural95: 37.9, diesel: 42.9 }]);
  db.getLatest2ForStation.mockResolvedValue([{ id: 11, natural95: '38.50', diesel: '42.90' }]);
  db.getStationBySlug.mockResolvedValue({ id: 2 });
  db.getLatestForStation.mockResolvedValue({ natural95: '37.50', diesel: '42.50' });
  await runCheck();
  expect(notifier.sendNotification.mock.calls[0][1].latest.makro).toEqual({ natural95: 37.5, diesel: 42.5 });
});

test('does not notify when nothing changed', async () => {
  scrapeAll.mockResolvedValue([{ ...ONO, natural95: 39.5, diesel: 38.9 }]);
  db.getLatest2ForStation.mockResolvedValue([
    { id: 11, natural95: '39.50', diesel: '38.90' },
    { id: 10, natural95: '39.50', diesel: '38.90' },
  ]);
  await runCheck();
  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(push.sendPriceChangePush).not.toHaveBeenCalled();
  expect(db.deleteRecord).toHaveBeenCalledWith(11);
  expect(db.saveCheck).toHaveBeenCalledWith(1, { natural95: 39.5, diesel: 38.9 }, false);
});

test('first-ever reading for a station saves but does not notify', async () => {
  scrapeAll.mockResolvedValue([{ ...MAKRO, natural95: 41.0, diesel: 40.0 }]);
  db.getLatest2ForStation.mockResolvedValue([]);
  await runCheck();
  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(db.saveCheck).toHaveBeenCalledWith(2, { natural95: 41.0, diesel: 40.0 }, true);
});
