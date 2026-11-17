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
  expect(stationSummary(STATIONS[1], [])).toMatchObject({ slug: 'makro', available: false });
});

test('normalizePrefs drops unknown values and rejects empty choices', () => {
  expect(normalizePrefs({ stations: ['makro', 'evil', 'makro'], fuels: 'diesel' })).toEqual({ stations: ['makro'], fuels: ['diesel'] });
  expect(normalizePrefs({ stations: [], fuels: ['diesel'] })).toBeNull();
  expect(normalizePrefs({ stations: ['tank-ono'] })).toBeNull();
});

test('prefsFrom defaults to everything only when prefs are absent', () => {
  expect(prefsFrom({ email: 'x' })).toEqual({ stations: ['tank-ono', 'makro'], fuels: ['natural95', 'diesel'] });
  expect(prefsFrom({ stations: ['nope'], fuels: ['diesel'] })).toBeNull();
});
