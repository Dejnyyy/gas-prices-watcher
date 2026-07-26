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
