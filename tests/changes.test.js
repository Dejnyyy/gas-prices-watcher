const { flattenChanges, filterForPrefs, buildHeadline, buildPushPayload } = require('../src/changes');

const ono = (o, n) => ({ slug: 'tank-ono', name: 'Tank ONO', old: o, new: n });
const mk = (o, n) => ({ slug: 'makro', name: 'Makro', old: o, new: n });

test('flattenChanges keeps only fuels that moved, ordered station then fuel', () => {
  const items = flattenChanges([
    mk({ natural95: 38, diesel: 40 }, { natural95: 38, diesel: 40.2 }),
    ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40 }),
  ]);
  expect(items.map((i) => i.slug + ':' + i.fuel)).toEqual(['tank-ono:natural95', 'makro:diesel']);
  expect(items[0]).toMatchObject({ delta: -0.6, label: 'Tank ONO Teplice', fuelLabel: 'Natural 95' });
});

test('single change headline', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40 })]);
  expect(buildHeadline(items)).toBe('Tank ONO Teplice: Natural 95 ↓ 37,90 Kč (−0,60)');
});

test('two fuels at one station', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 39.6 }, { natural95: 37.9, diesel: 39.9 })]);
  expect(buildHeadline(items)).toBe('Natural 95 ↓ 37,90 (−0,60) · Nafta ↑ 39,90 (+0,30) — Tank ONO Teplice');
});

test('both stations — compact', () => {
  const items = flattenChanges([
    ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40 }),
    mk({ natural95: 38, diesel: 38.3 }, { natural95: 38, diesel: 38.5 }),
  ]);
  expect(buildHeadline(items)).toBe('ONO: N95 37,90 ↓0,60 · Makro: Nafta 38,50 ↑0,20');
});

test('filterForPrefs honours station and fuel choices', () => {
  const items = flattenChanges([
    ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40.5 }),
    mk({ natural95: 38, diesel: 38.3 }, { natural95: 37, diesel: 38.5 }),
  ]);
  expect(filterForPrefs(items, { stations: ['makro'], fuels: ['diesel'] }).map((i) => i.slug + i.fuel)).toEqual(['makrodiesel']);
  expect(filterForPrefs(items, { stations: ['tank-ono', 'makro'], fuels: ['natural95'] })).toHaveLength(2);
  expect(filterForPrefs(items, { stations: ['tank-ono'], fuels: ['diesel'] })).toHaveLength(1);
});

test('push payload: title = the change, body = current prices of followed fuels', () => {
  const items = flattenChanges([ono({ natural95: 38.5, diesel: 40 }, { natural95: 37.9, diesel: 40 })]);
  const p = buildPushPayload(items, { 'tank-ono': { natural95: 37.9, diesel: 40 } });
  expect(p.title).toBe('Tank ONO Teplice: Natural 95 ↓ 37,90 Kč (−0,60)');
  expect(p.body).toBe('Tank ONO Teplice: N95 37,90 ↓ · Nafta 40,00 Kč');
  const onlyN95 = buildPushPayload(items, { 'tank-ono': { natural95: 37.9, diesel: 40 } }, { stations: ['tank-ono'], fuels: ['natural95'] });
  expect(onlyN95.body).toBe('Tank ONO Teplice: N95 37,90 ↓ Kč');
});
