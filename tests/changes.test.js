const { flattenChanges, filterForPrefs, buildHeadline, buildPushPayload } = require('../src/changes');

const ono = (o, n) => ({ slug: 'tank-ono', name: 'Tank ONO', old: o, new: n });
const ONO = ['tank-ono'];

test('flattenChanges keeps only fuels that moved, in fuel order', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40.2 })]);
  expect(items.map((i) => i.slug + ':' + i.fuel)).toEqual(['tank-ono:natural95', 'tank-ono:diesel']);
  expect(items[0]).toMatchObject({ delta: -0.6, label: 'Tank ONO', fuelLabel: 'Natural 95' });
  expect(flattenChanges([ono({ natural95: 38, diesel: 40 }, { natural95: 38, diesel: 40 })])).toEqual([]);
});

test('single change headline', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40 })]);
  expect(buildHeadline(items)).toBe('Tank ONO: Natural 95 ↓ 37,90 Kč (−0,60)');
});

test('two fuels at once', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 39.6 }, { natural95: 37.9, diesel: 39.9 })]);
  expect(buildHeadline(items)).toBe('Natural 95 ↓ 37,90 (−0,60) · Nafta ↑ 39,90 (+0,30) — Tank ONO');
});

test('filterForPrefs honours the fuel choice', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40.5 })]);
  expect(filterForPrefs(items, { stations: ONO, fuels: ['diesel'] }).map((i) => i.fuel)).toEqual(['diesel']);
  expect(filterForPrefs(items, { stations: ONO, fuels: ['natural95', 'diesel'] })).toHaveLength(2);
});

test('push payload: title = the change, body = current prices of followed fuels', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40 })]);
  const p = buildPushPayload(items, { 'tank-ono': { natural95: 37.9, diesel: 40 } });
  expect(p.title).toBe('Tank ONO: Natural 95 ↓ 37,90 Kč (−0,60)');
  expect(p.body).toBe('Tank ONO: N95 37,90 ↓ · Nafta 40,00 Kč');
  const onlyN95 = buildPushPayload(items, { 'tank-ono': { natural95: 37.9, diesel: 40 } }, { stations: ONO, fuels: ['natural95'] });
  expect(onlyN95.body).toBe('Tank ONO: N95 37,90 ↓ Kč');
});
