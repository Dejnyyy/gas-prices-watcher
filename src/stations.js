// Single source of truth for the stations and fuels the watcher tracks.
// Anything not listed here is kept in the DB for history but marked inactive.

const STATIONS = [
  {
    slug: 'tank-ono',
    name: 'Tank ONO',
    location: 'Teplice',
    label: 'Tank ONO Teplice', // used in subjects / push titles
    short: 'ONO',             // used in compact multi-station subjects
    source: 'tank_ono',
    isPrimary: true,
    sortOrder: 0,
    url: 'https://www.tank-ono.cz/cz/index.php?page=cenik',
  },
  {
    slug: 'makro',
    name: 'Makro',
    location: 'Ústí n. L. – Trmice',
    label: 'Makro Trmice',
    short: 'Makro',
    source: 'makro',
    isPrimary: false,
    sortOrder: 1,
    url: 'https://www.makro.cz/prodejny/usti-nad-labem',
  },
];

const FUELS = [
  { key: 'natural95', label: 'Natural 95', short: 'N95' },
  { key: 'diesel', label: 'Nafta', short: 'Nafta' },
];

const STATION_SLUGS = STATIONS.map((s) => s.slug);
const FUEL_KEYS = FUELS.map((f) => f.key);

function stationBySlug(slug) {
  return STATIONS.find((s) => s.slug === slug) || null;
}

function fuelByKey(key) {
  return FUELS.find((f) => f.key === key) || null;
}

// Normalises user-supplied preferences (array or comma string) to a sorted list
// of known values. Unknown values are dropped; an empty result means "invalid".
function normalizeList(input, allowed) {
  let arr = input;
  if (typeof arr === 'string') arr = arr.split(',');
  if (!Array.isArray(arr)) return [];
  const set = new Set(arr.map((v) => String(v).trim()).filter((v) => allowed.includes(v)));
  return allowed.filter((v) => set.has(v));
}

function normalizePrefs({ stations, fuels } = {}) {
  const s = normalizeList(stations, STATION_SLUGS);
  const f = normalizeList(fuels, FUEL_KEYS);
  if (!s.length || !f.length) return null;
  return { stations: s, fuels: f };
}

const ALL_PREFS = { stations: [...STATION_SLUGS], fuels: [...FUEL_KEYS] };

module.exports = {
  STATIONS, FUELS, STATION_SLUGS, FUEL_KEYS, ALL_PREFS,
  stationBySlug, fuelByKey, normalizeList, normalizePrefs,
};
