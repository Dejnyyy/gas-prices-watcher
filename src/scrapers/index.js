const tankOno = require('./tankOno');
const makro = require('./makro');
const { stationBySlug } = require('../stations');

function fmt(v) { return v.toFixed(2).replace('.', ','); }

function entry(slug, prices) {
  const st = stationBySlug(slug);
  return {
    slug: st.slug, name: st.name, location: st.location, label: st.label,
    source: st.source, isPrimary: st.isPrimary, sortOrder: st.sortOrder,
    natural95: prices.natural95, diesel: prices.diesel,
  };
}

// Scrapes the two tracked stations. A failing station is logged and skipped;
// the other one still gets saved.
async function scrapeAll({ log = console.log, logError = console.error } = {}) {
  const results = [];

  try {
    const ono = await tankOno.fetchPrices();
    if (ono) {
      results.push(entry('tank-ono', ono));
      log('  ✓ tank-ono (' + ono.station + '): N95 ' + fmt(ono.natural95) + ' · Nafta ' + fmt(ono.diesel));
    } else {
      logError('  ✗ tank-ono: Teplice row not parsed (see above)');
    }
  } catch (err) {
    logError('  ✗ tank-ono: ' + (err.response ? 'HTTP ' + err.response.status : err.message));
  }

  try {
    const mk = await makro.fetchPrices({ log: logError });
    if (mk) {
      results.push(entry('makro', mk));
      log('  ✓ makro (' + mk.source + '): N95 ' + fmt(mk.natural95) + ' · Nafta ' + fmt(mk.diesel));
    } else {
      logError('  ✗ makro: no data this cycle');
    }
  } catch (err) {
    logError('  ✗ makro: ' + err.message);
  }

  return results;
}

module.exports = { scrapeAll };
