const FUELS = ['natural95', 'diesel'];

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

function rankStations(stations, limit = 10) {
  return [...stations]
    .sort((a, b) => Number(a.natural95) - Number(b.natural95) || Number(a.diesel) - Number(b.diesel))
    .slice(0, limit)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

module.exports = { computeLastMove, rankStations };
