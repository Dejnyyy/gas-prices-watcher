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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  db.upsertStation.mockResolvedValue(1);
  notifier.sendNotification.mockResolvedValue({ sent: 1, skipped: 0 });
  push.sendPriceChangePush.mockResolvedValue({ sent: 1, pruned: 0, skipped: 0 });
});

test('a Tank ONO change is notified with current prices', async () => {
  scrapeAll.mockResolvedValue([{ ...ONO, natural95: 37.9, diesel: 42.9 }]);
  db.getLatest2ForStation.mockResolvedValue([{ id: 11, natural95: '38.50', diesel: '42.90' }]);

  await runCheck();

  expect(notifier.sendNotification).toHaveBeenCalledTimes(1);
  const [changes, opts] = notifier.sendNotification.mock.calls[0];
  expect(changes).toEqual([expect.objectContaining({
    slug: 'tank-ono', old: { natural95: 38.5, diesel: 42.9 }, new: { natural95: 37.9, diesel: 42.9 },
  })]);
  expect(opts.latest).toEqual({ 'tank-ono': { natural95: 37.9, diesel: 42.9 } });
  expect(push.sendPriceChangePush).toHaveBeenCalledWith(changes, { latest: opts.latest });
  expect(db.saveCheck).toHaveBeenCalledWith(1, { natural95: 37.9, diesel: 42.9 }, true);
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
  scrapeAll.mockResolvedValue([{ ...ONO, natural95: 41.0, diesel: 40.0 }]);
  db.getLatest2ForStation.mockResolvedValue([]);
  await runCheck();
  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(db.saveCheck).toHaveBeenCalledWith(1, { natural95: 41.0, diesel: 40.0 }, true);
});

test('a difference against a check older than 48 h is saved but not notified', async () => {
  scrapeAll.mockResolvedValue([{ ...ONO, natural95: 37.9, diesel: 42.9 }]);
  const old = new Date(Date.now() - 100 * 24 * 3600 * 1000);
  db.getLatest2ForStation.mockResolvedValue([{ id: 11, natural95: '38.50', diesel: '40.50', checked_at: old }]);
  await runCheck();
  expect(db.saveCheck).toHaveBeenCalledWith(1, { natural95: 37.9, diesel: 42.9 }, true);
  expect(notifier.sendNotification).not.toHaveBeenCalled();
  expect(push.sendPriceChangePush).not.toHaveBeenCalled();
});

test('a difference against a recent check is notified', async () => {
  scrapeAll.mockResolvedValue([{ ...ONO, natural95: 37.9, diesel: 42.9 }]);
  const recent = new Date(Date.now() - 5 * 60 * 1000);
  db.getLatest2ForStation.mockResolvedValue([{ id: 11, natural95: '38.50', diesel: '42.90', checked_at: recent }]);
  await runCheck();
  expect(notifier.sendNotification).toHaveBeenCalledTimes(1);
});
