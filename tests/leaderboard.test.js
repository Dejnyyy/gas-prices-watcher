const { computeLastMove, rankStations } = require('../src/leaderboard');

describe('computeLastMove', () => {
  test('returns [] when history never changes', () => {
    const rows = [
      { natural95: 39.5, diesel: 38.9, checked_at: '2026-07-20T10:00:00' },
      { natural95: 39.5, diesel: 38.9, checked_at: '2026-07-20T10:05:00' },
    ];
    expect(computeLastMove(rows)).toEqual([]);
  });

  test('detects a single-fuel drop at the latest change', () => {
    const rows = [
      { natural95: 39.9, diesel: 38.9, checked_at: '2026-07-20T10:00:00' },
      { natural95: 39.5, diesel: 38.9, checked_at: '2026-07-20T12:00:00' },
    ];
    const moves = computeLastMove(rows);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ fuel: 'natural95', delta: -0.4, direction: 'down', at: '2026-07-20T12:00:00' });
  });

  test('returns both fuels when both change in the same check', () => {
    const rows = [
      { natural95: 39.9, diesel: 38.9, checked_at: '2026-07-20T10:00:00' },
      { natural95: 40.1, diesel: 38.5, checked_at: '2026-07-20T12:00:00' },
    ];
    const moves = computeLastMove(rows);
    expect(moves.map((m) => m.fuel).sort()).toEqual(['diesel', 'natural95']);
    expect(moves.find((m) => m.fuel === 'natural95').direction).toBe('up');
    expect(moves.find((m) => m.fuel === 'diesel').direction).toBe('down');
  });

  test('reports the most recent change, not an older one', () => {
    const rows = [
      { natural95: 40.0, diesel: 38.0, checked_at: '2026-07-18T10:00:00' },
      { natural95: 39.5, diesel: 38.0, checked_at: '2026-07-19T10:00:00' }, // n95 change
      { natural95: 39.5, diesel: 37.5, checked_at: '2026-07-20T10:00:00' }, // diesel change (latest)
    ];
    const moves = computeLastMove(rows);
    expect(moves).toHaveLength(1);
    expect(moves[0].fuel).toBe('diesel');
  });

  test('treats numerically-equal string prices as unchanged (DB returns strings)', () => {
    const rows = [
      { natural95: '39.90', diesel: '38.90', checked_at: '2026-07-20T10:00:00' },
      { natural95: '39.50', diesel: '38.90', checked_at: '2026-07-20T11:00:00' }, // real N95 drop
      { natural95: '39.5',  diesel: '38.9',  checked_at: '2026-07-20T12:00:00' }, // same values, different string form
    ];
    const moves = computeLastMove(rows);
    // latest row is numerically identical to the prior -> the most recent REAL change is the N95 drop
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ fuel: 'natural95', delta: -0.4, direction: 'down' });
  });
});

describe('rankStations', () => {
  const stations = [
    { slug: 'a', name: 'A', is_primary: 0, natural95: 40.5, diesel: 39.9, lastMove: [] },
    { slug: 'tank-ono', name: 'Tank ONO', is_primary: 1, natural95: 39.5, diesel: 38.9, lastMove: [] },
    { slug: 'b', name: 'B', is_primary: 0, natural95: 40.5, diesel: 39.5, lastMove: [] },
  ];

  test('sorts by natural95 then diesel and assigns rank', () => {
    const ranked = rankStations(stations, 10);
    expect(ranked.map((s) => s.slug)).toEqual(['tank-ono', 'b', 'a']);
    expect(ranked.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  test('caps to the limit', () => {
    expect(rankStations(stations, 2)).toHaveLength(2);
  });

  test('sorts string-valued prices numerically, not lexicographically', () => {
    const stringStations = [
      { slug: 'x', name: 'X', is_primary: 0, natural95: '9.50', diesel: '9.00', lastMove: [] },
      { slug: 'y', name: 'Y', is_primary: 0, natural95: '40.50', diesel: '39.00', lastMove: [] },
    ];
    // lexicographically '40.50' < '9.50'; numerically 9.5 < 40.5 -> 'x' must rank first
    const ranked = rankStations(stringStations, 10);
    expect(ranked.map((s) => s.slug)).toEqual(['x', 'y']);
  });
});
