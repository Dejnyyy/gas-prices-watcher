// Price-movement helpers for the dashboard (the old multi-brand leaderboard is gone).
const FUELS = ['natural95', 'diesel'];

// Most recent check where at least one fuel moved -> [{ fuel, from, to, delta, direction, at }].
function computeLastMove(rows) {
  for (let i = rows.length - 1; i >= 1; i--) {
    const cur = rows[i];
    const prev = rows[i - 1];
    const moves = [];
    for (const fuel of FUELS) {
      const from = Number(prev[fuel]);
      const to = Number(cur[fuel]);
      if (from !== to) {
        const delta = Math.round((to - from) * 100) / 100;
        moves.push({ fuel, from, to, delta, direction: delta > 0 ? 'up' : 'down', at: cur.checked_at });
      }
    }
    if (moves.length) return moves;
  }
  return [];
}

// Last move of each fuel independently -> { natural95: move|null, diesel: move|null }.
function computeLastMoveByFuel(rows) {
  const out = {};
  for (const fuel of FUELS) {
    out[fuel] = null;
    for (let i = rows.length - 1; i >= 1; i--) {
      const from = Number(rows[i - 1][fuel]);
      const to = Number(rows[i][fuel]);
      if (from !== to) {
        const delta = Math.round((to - from) * 100) / 100;
        out[fuel] = { fuel, from, to, delta, direction: delta > 0 ? 'up' : 'down', at: rows[i].checked_at };
        break;
      }
    }
  }
  return out;
}

module.exports = { computeLastMove, computeLastMoveByFuel };
