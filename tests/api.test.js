const { buildLeaderboard } = require('../src/index');

test('buildLeaderboard ranks, caps at 10, and marks primary', () => {
  const stations = [];
  for (let i = 0; i < 12; i++) {
    stations.push({ slug: 's' + i, name: 'S' + i, is_primary: 0, natural95: 45 - i * 0.1, diesel: 44, lastMove: [] });
  }
  stations.push({ slug: 'tank-ono', name: 'Tank ONO', is_primary: 1, natural95: 39.5, diesel: 38.9, lastMove: [] });

  const { primary, stations: ranked } = buildLeaderboard(stations);
  expect(ranked).toHaveLength(10);
  expect(ranked[0].slug).toBe('tank-ono');
  expect(ranked[0].rank).toBe(1);
  expect(primary.slug).toBe('tank-ono');
});

test('buildLeaderboard always includes the primary even when it is not in the 10 cheapest', () => {
  const stations = [];
  for (let i = 0; i < 12; i++) {
    // 12 competitors, all cheaper than the primary
    stations.push({ slug: 'c' + i, name: 'C' + i, is_primary: 0, natural95: 38 + i * 0.1, diesel: 37, lastMove: [] });
  }
  stations.push({ slug: 'tank-ono', name: 'Tank ONO', is_primary: 1, natural95: 44.0, diesel: 43.0, lastMove: [] });

  const { primary, stations: display } = buildLeaderboard(stations);
  // 10 cheapest competitors + the appended primary = 11 rows
  expect(display).toHaveLength(11);
  expect(display.some((s) => s.slug === 'tank-ono')).toBe(true);
  expect(primary.slug).toBe('tank-ono');
  expect(primary.rank).toBe(13); // most expensive of 13 stations
  expect(display[display.length - 1].slug).toBe('tank-ono'); // appended last
});
