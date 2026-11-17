const fs = require('fs');
const path = require('path');
const makro = require('../../src/scrapers/makro');
const { parseListing, joinFuels } = require('../../src/scrapers/mbenzin');

const fixture = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8');

beforeEach(() => makro._resetCooldowns());

test('parseStorePage reads plain Natural 95 + diesel, not the premium Drive fuels', () => {
  expect(makro.parseStorePage(fixture('makro-store.html'))).toEqual({ natural95: 37.9, diesel: 42.9 });
});

test('parseStorePage returns null without the price block (e.g. a 403 page)', () => {
  expect(makro.parseStorePage('<html><title>403</title></html>')).toBeNull();
});

test('pickFromMbenzin targets the Žižkova (Trmice) Makro by mbenzin id', () => {
  const joined = joinFuels(
    parseListing(fixture('mbenzin-listing.html'), 'natural95'),
    parseListing(fixture('mbenzin-nafta.html'), 'diesel')
  );
  const p = makro.pickFromMbenzin(joined);
  expect(p).toEqual({ natural95: 41.5, diesel: expect.any(Number) });
});

test('pickFromMbenzin falls back to the Žižkova street when the id changes', () => {
  const p = makro.pickFromMbenzin([
    { id: '1', name: 'Makro', street: 'Jinde 1', natural95: 40, diesel: 41 },
    { id: '2', name: 'Makro', street: 'Žižkova 78/3363', natural95: 38, diesel: 39 },
  ]);
  expect(p).toEqual({ natural95: 38, diesel: 39 });
});

test('fetchPrices falls through sources, tags the one used, and cools down blocked ones', async () => {
  const blocked = Object.assign(new Error('x'), { response: { status: 403 } });
  const a = { id: 'a', fetch: jest.fn().mockRejectedValue(blocked) };
  const b = { id: 'b', fetch: jest.fn().mockResolvedValue({ natural95: 38, diesel: 39 }) };
  const log = jest.fn();

  expect(await makro.fetchPrices({ sources: [a, b], log, now: 1000 })).toEqual({ natural95: 38, diesel: 39, source: 'b' });
  // within the cooldown window source "a" is not hit again
  await makro.fetchPrices({ sources: [a, b], log, now: 2000 });
  expect(a.fetch).toHaveBeenCalledTimes(1);
  // after an hour it is retried
  await makro.fetchPrices({ sources: [a, b], log, now: 1000 + 61 * 60 * 1000 });
  expect(a.fetch).toHaveBeenCalledTimes(2);
});

test('fetchPrices returns null and logs every reason when all sources fail', async () => {
  const gated = Object.assign(new Error('mbenzin bot gate'), { code: 'GATED' });
  const log = jest.fn();
  const res = await makro.fetchPrices({
    sources: [
      { id: 'makro.cz', fetch: () => Promise.reject(Object.assign(new Error('x'), { response: { status: 403 } })) },
      { id: 'mbenzin.cz', fetch: () => Promise.reject(gated) },
    ],
    log,
  });
  expect(res).toBeNull();
  expect(log.mock.calls[0][0]).toMatch(/makro\.cz: HTTP 403; mbenzin\.cz: mbenzin bot gate/);
});
