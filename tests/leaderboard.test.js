const { computeLastMove, computeLastMoveByFuel } = require('../src/leaderboard');

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

describe('computeLastMoveByFuel', () => {
  test('tracks each fuel independently', () => {
    const rows = [
      { natural95: 40.0, diesel: 38.0, checked_at: 'a' },
      { natural95: 39.5, diesel: 38.0, checked_at: 'b' },
      { natural95: 39.5, diesel: 37.5, checked_at: 'c' },
      { natural95: 39.5, diesel: 37.5, checked_at: 'd' },
    ];
    const m = computeLastMoveByFuel(rows);
    expect(m.natural95).toMatchObject({ delta: -0.5, at: 'b', direction: 'down' });
    expect(m.diesel).toMatchObject({ delta: -0.5, at: 'c' });
  });
  test('null when a fuel never moved', () => {
    expect(computeLastMoveByFuel([{ natural95: 1, diesel: 2 }, { natural95: 1, diesel: 2 }])).toEqual({ natural95: null, diesel: null });
  });
});

describe('observation gaps (> 48 h between two checks)', () => {
  const { markGaps, isGap } = require('../src/leaderboard');
  // Makro: scraper down 2 Aug – 18 Nov, then a manually entered price.
  const rows = [
    { natural95: 38.5, diesel: 40.0, checked_at: '2026-07-30T10:00:00Z' },
    { natural95: 38.5, diesel: 40.5, checked_at: '2026-08-01T09:00:00Z' },
    { natural95: 38.5, diesel: 40.5, checked_at: '2026-08-02T08:00:00Z' },
    { natural95: 37.9, diesel: 42.9, checked_at: '2026-11-18T12:00:00Z' },
  ];

  test('isGap is true only above 48 hours', () => {
    expect(isGap({ checked_at: '2026-08-01T00:00:00Z' }, { checked_at: '2026-08-03T00:00:00Z' })).toBe(false);
    expect(isGap({ checked_at: '2026-08-01T00:00:00Z' }, { checked_at: '2026-08-03T00:01:00Z' })).toBe(true);
    expect(isGap({ checked_at: new Date('2026-08-01T00:00:00Z') }, { checked_at: new Date('2026-11-18T00:00:00Z') })).toBe(true);
  });

  test('a difference across a gap is not the last move (and older moves are not either)', () => {
    expect(computeLastMove(rows)).toEqual([]);
    expect(computeLastMoveByFuel(rows)).toEqual({ natural95: null, diesel: null });
  });

  test('changes observed after the gap are reported normally', () => {
    const more = [...rows, { natural95: 37.5, diesel: 42.9, checked_at: '2026-11-18T12:05:00Z' }];
    expect(computeLastMove(more)).toEqual([
      expect.objectContaining({ fuel: 'natural95', from: 37.9, to: 37.5, delta: -0.4 }),
    ]);
    const byFuel = computeLastMoveByFuel(more);
    expect(byFuel.natural95).toMatchObject({ delta: -0.4, at: '2026-11-18T12:05:00Z' });
    expect(byFuel.diesel).toBeNull();
  });

  test('a gap without a price difference does not hide older moves', () => {
    const quiet = [
      { natural95: 38.0, diesel: 40.0, checked_at: '2026-07-01T10:00:00Z' },
      { natural95: 38.5, diesel: 40.0, checked_at: '2026-07-01T10:05:00Z' },
      { natural95: 38.5, diesel: 40.0, checked_at: '2026-07-20T10:00:00Z' },
    ];
    expect(computeLastMove(quiet)).toEqual([expect.objectContaining({ fuel: 'natural95', delta: 0.5 })]);
  });

  test('markGaps flags the row after a gap only', () => {
    const marked = markGaps(rows);
    expect(marked.map((r) => !!r.gap)).toEqual([false, false, false, true]);
    expect(marked[3]).toMatchObject({ natural95: 37.9, diesel: 42.9 });
    expect(rows[3].gap).toBeUndefined(); // input untouched
    expect(markGaps([])).toEqual([]);
  });
});
