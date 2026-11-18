// Pure helpers that turn station-level price changes into per-fuel items,
// filter them by subscriber preferences and render the compact headlines used
// as e-mail subjects and push titles.
const { STATIONS, FUELS, stationBySlug, fuelByKey } = require('./stations');

const MINUS = '−';

function round2(v) { return Math.round(v * 100) / 100; }

function price(v) { return Number(v).toFixed(2).replace('.', ','); }

function signed(d) {
  if (d === 0) return '±0,00';
  return (d > 0 ? '+' : MINUS) + price(Math.abs(d));
}

function arrow(d) { return d > 0 ? '↑' : d < 0 ? '↓' : '→'; }

function stationOrder(slug) {
  const i = STATIONS.findIndex((s) => s.slug === slug);
  return i === -1 ? 99 : i;
}

function fuelOrder(key) {
  const i = FUELS.findIndex((f) => f.key === key);
  return i === -1 ? 99 : i;
}

/**
 * changes: [{ slug, name, label?, old: {natural95, diesel}, new: {natural95, diesel} }]
 * -> [{ slug, label, short, fuel, fuelLabel, fuelShort, old, new, delta }]
 * Only fuels whose price actually moved are returned.
 */
function flattenChanges(changes) {
  const items = [];
  for (const c of changes || []) {
    const st = stationBySlug(c.slug) || { label: c.label || c.name, short: c.name, location: '' };
    for (const f of FUELS) {
      const o = Number(c.old[f.key]);
      const n = Number(c.new[f.key]);
      const delta = round2(n - o);
      if (!delta) continue;
      items.push({
        slug: c.slug, label: st.label || c.name, short: st.short || c.name, location: st.location || '',
        fuel: f.key, fuelLabel: f.label, fuelShort: f.short,
        old: o, new: n, delta,
      });
    }
  }
  return items.sort((a, b) => stationOrder(a.slug) - stationOrder(b.slug) || fuelOrder(a.fuel) - fuelOrder(b.fuel));
}

function filterForPrefs(items, prefs) {
  if (!prefs) return items;
  return items.filter((i) => prefs.stations.includes(i.slug) && prefs.fuels.includes(i.fuel));
}

function groupByStation(items) {
  const groups = [];
  for (const it of items) {
    let g = groups.find((x) => x.slug === it.slug);
    if (!g) { g = { slug: it.slug, label: it.label, short: it.short, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return groups;
}

/**
 * The headline says what changed and where, nothing else:
 *   1 change:            "Tank ONO: Natural 95 ↓ 37,90 Kč (−0,60)"
 *   1 station, 2 fuels:  "Natural 95 ↓ 37,90 (−0,60) · Nafta ↑ 39,90 (+0,30) — Tank ONO"
 *   several stations:    "ONO: N95 37,90 ↓0,60 · X: Nafta 38,50 ↑0,20" (unused while only ONO is tracked)
 */
function buildHeadline(items) {
  if (!items || !items.length) return 'Změna cen paliv';
  const groups = groupByStation(items);
  if (groups.length === 1) {
    const g = groups[0];
    if (g.items.length === 1) {
      const i = g.items[0];
      return g.label + ': ' + i.fuelLabel + ' ' + arrow(i.delta) + ' ' + price(i.new) + ' Kč (' + signed(i.delta) + ')';
    }
    return g.items.map((i) => i.fuelLabel + ' ' + arrow(i.delta) + ' ' + price(i.new) + ' (' + signed(i.delta) + ')').join(' · ') +
      ' — ' + g.label;
  }
  return groups.map((g) =>
    g.short + ': ' + g.items.map((i) => i.fuelShort + ' ' + price(i.new) + ' ' + arrow(i.delta) + price(Math.abs(i.delta))).join(', ')
  ).join(' · ');
}

/**
 * Push: title = the change, body = the new prices of each affected station
 * (all fuels the subscriber follows, so the comparison is right there).
 * `latest` maps slug -> { natural95, diesel } (current prices).
 */
function buildPushPayload(items, latest = {}, prefs = null) {
  const groups = groupByStation(items);
  const fuels = FUELS.filter((f) => !prefs || prefs.fuels.includes(f.key));
  const body = groups.map((g) => {
    const cur = latest[g.slug] || {};
    const parts = fuels.map((f) => {
      const changed = g.items.find((i) => i.fuel === f.key);
      const v = changed ? changed.new : cur[f.key];
      if (v == null) return null;
      return f.short + ' ' + price(v) + (changed ? ' ' + arrow(changed.delta) : '');
    }).filter(Boolean);
    return g.label + ': ' + parts.join(' · ') + ' Kč';
  }).join('\n');
  return {
    title: buildHeadline(items),
    body,
    url: '/',
    tag: 'price-' + items.map((i) => i.slug + i.fuel + i.new).join('-'),
  };
}

module.exports = {
  flattenChanges, filterForPrefs, groupByStation, buildHeadline, buildPushPayload,
  price, signed, arrow, round2, MINUS, fuelByKey,
};
