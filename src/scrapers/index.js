const tankOno = require('./tankOno');
const mbenzin = require('./mbenzin');

// Only these mbenzin brands are tracked, each collapsed to a single stable slug.
// EuroOil has several locations in town — we keep the cheapest one (by Natural95,
// diesel as tie-break), so the leaderboard shows one "cheapest EuroOil" line.
const MBENZIN_BRANDS = { EuroOil: 'eurooil', Makro: 'makro' };

function cheaper(a, b) {
  if (!a) return b;
  if (b.natural95 !== a.natural95) return b.natural95 < a.natural95 ? b : a;
  return b.diesel < a.diesel ? b : a;
}

// Keep only allow-listed brands, collapsing multiple locations of a brand to the
// cheapest, and emitting one entry per brand under a stable slug.
function pickMbenzinStations(stations) {
  const byBrand = new Map();
  for (const s of stations) {
    const slug = MBENZIN_BRANDS[s.name];
    if (!slug) continue;
    byBrand.set(slug, cheaper(byBrand.get(slug), { slug, name: s.name, natural95: s.natural95, diesel: s.diesel }));
  }
  return [...byBrand.values()];
}

async function scrapeAll() {
  const results = [];

  try {
    const ono = await tankOno.fetchPrices();
    if (ono) {
      results.push({
        slug: 'tank-ono', name: 'Tank ONO', source: 'tank_ono',
        isPrimary: true, natural95: ono.natural95, diesel: ono.diesel,
      });
    }
  } catch (err) {
    console.error('tankOno scraper failed:', err.message);
  }

  try {
    const stations = await mbenzin.fetchStations();
    for (const s of pickMbenzinStations(stations)) {
      results.push({
        slug: s.slug, name: s.name, source: 'mbenzin',
        isPrimary: false, natural95: s.natural95, diesel: s.diesel,
      });
    }
  } catch (err) {
    console.error('mbenzin scraper failed:', err.message);
  }

  return results;
}

module.exports = { scrapeAll, pickMbenzinStations };
