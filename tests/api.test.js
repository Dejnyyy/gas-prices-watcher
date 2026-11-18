const { stationSummary, prefsFrom } = require('../src/index');
const { normalizePrefs, STATIONS } = require('../src/stations');

test('stationSummary exposes latest prices and per-fuel last moves', () => {
  const rows = [
    { natural95: '38.50', diesel: '42.90', checked_at: '2026-11-10T08:00:00Z' },
    { natural95: '37.90', diesel: '42.90', checked_at: '2026-11-12T08:00:00Z' },
    { natural95: '37.90', diesel: '42.90', checked_at: '2026-11-18T01:00:00Z' },
  ];
  const s = stationSummary(STATIONS[0], rows);
  expect(s).toMatchObject({ slug: 'tank-ono', available: true, natural95: 37.9, diesel: 42.9, checked_at: '2026-11-18T01:00:00Z' });
  expect(s.lastMoveByFuel.natural95).toMatchObject({ delta: -0.6, at: '2026-11-12T08:00:00Z' });
  expect(s.lastMoveByFuel.diesel).toBeNull();
});

test('stationSummary marks a station without data as unavailable', () => {
  expect(stationSummary(STATIONS[0], [])).toMatchObject({ slug: 'tank-ono', available: false });
});

test('Tank ONO is the only tracked station', () => {
  expect(STATIONS.map((s) => s.slug)).toEqual(['tank-ono']);
});

test('normalizePrefs keeps known fuels, always follows Tank ONO, ignores old station choices', () => {
  expect(normalizePrefs({ fuels: ['diesel', 'evil', 'diesel'] })).toEqual({ stations: ['tank-ono'], fuels: ['diesel'] });
  expect(normalizePrefs({ stations: ['makro'], fuels: 'natural95' })).toEqual({ stations: ['tank-ono'], fuels: ['natural95'] });
  expect(normalizePrefs({ fuels: [] })).toBeNull();
  expect(normalizePrefs({ stations: ['tank-ono'] })).toBeNull();
});

test('prefsFrom defaults to everything only when prefs are absent', () => {
  expect(prefsFrom({ email: 'x' })).toEqual({ stations: ['tank-ono'], fuels: ['natural95', 'diesel'] });
  expect(prefsFrom({ fuels: ['nope'] })).toBeNull();
});
