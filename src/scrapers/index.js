const tankOno = require('./tankOno');
const mbenzin = require('./mbenzin');

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
    for (const s of stations) {
      results.push({
        slug: 'mbenzin-' + s.id, name: s.name, source: 'mbenzin',
        isPrimary: false, natural95: s.natural95, diesel: s.diesel,
      });
    }
  } catch (err) {
    console.error('mbenzin scraper failed:', err.message);
  }

  return results;
}

module.exports = { scrapeAll };
