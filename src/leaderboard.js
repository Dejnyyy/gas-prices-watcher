// Price-movement helpers for the dashboard (the old multi-brand leaderboard is gone).
const FUELS = ['natural95', 'diesel'];

// Two consecutive checks further apart than this mean the station was not
// observed in between (scraper down, manual price entry …): a price difference
// across such a gap happened at an unknown time, so it is not reported as a
// dated change. Normal operation stores a tick every 5 minutes.
const GAP_MS = 48 * 60 * 60 * 1000;

function ts(v) { return v instanceof Date ? v.getTime() : new Date(v).getTime(); }

function isGap(prev, cur) {
  const a = ts(prev.checked_at);
  const b = ts(cur.checked_at);
  return Number.isFinite(a) && Number.isFinite(b) && b - a > GAP_MS;
}

function moveOf(fuel, prev, cur) {
  const from = Number(prev[fuel]);
  const to = Number(cur[fuel]);
  if (from === to) return null;
  const delta = Math.round((to - from) * 100) / 100;
  return { fuel, from, to, delta, direction: delta > 0 ? 'up' : 'down', at: cur.checked_at };
}

// Most recent check where at least one fuel moved -> [{ fuel, from, to, delta, direction, at }].
// A difference across an observation gap ends the search: the real last move
// happened somewhere inside the gap, so nothing older is "the last move" either.
function computeLastMove(rows) {
  for (let i = rows.length - 1; i >= 1; i--) {
    const moves = FUELS.map((fuel) => moveOf(fuel, rows[i - 1], rows[i])).filter(Boolean);
    if (!moves.length) continue;
    if (isGap(rows[i - 1], rows[i])) return [];
    return moves;
  }
  return [];
}

// Last move of each fuel independently -> { natural95: move|null, diesel: move|null }.
function computeLastMoveByFuel(rows) {
  const out = {};
  for (const fuel of FUELS) {
    out[fuel] = null;
    for (let i = rows.length - 1; i >= 1; i--) {
      const m = moveOf(fuel, rows[i - 1], rows[i]);
      if (!m) continue;
      if (!isGap(rows[i - 1], rows[i])) out[fuel] = m;
      break;
    }
  }
  return out;
}

// History rows (ascending) -> same rows, those following an observation gap
// flagged with `gap: true` (the dashboard breaks the chart line there and
// leaves the difference out of the change table).
function markGaps(rows) {
  return (rows || []).map((r, i) => (i > 0 && isGap(rows[i - 1], r) ? { ...r, gap: true } : r));
}

module.exports = { computeLastMove, computeLastMoveByFuel, markGaps, isGap, GAP_MS };
