const axios = require('axios');
const cheerio = require('cheerio');

const CENIK_URL = 'https://www.tank-ono.cz/cz/index.php?page=cenik';
const KEY = 'tank-ono';
// The row we track. Matched exactly first, then as a prefix (e.g. "ČS Teplice - …").
const STATION_ROW = process.env.TANK_ONO_STATION || 'ČS Teplice';
const UA = 'Mozilla/5.0 (compatible; DejnyHlidac/2.0; +https://beno.dejny.eu)';

/** Parse a CZK price string like "38,90" or "---" into a float or null. */
function parsePrice(raw) {
  const cleaned = String(raw || '').trim().replace(',', '.').replace(/[^\d.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) || value === 0 ? null : value;
}

function normName(s) {
  return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('cs');
}

/**
 * Parse prices of one named station from the Tank ONO ceník HTML.
 *
 * table.cenik: the header row has <th> cells with fuel images (n95_c.gif,
 * d_c.gif …); the first <th> is the logo and lines up with the station-name
 * <td> in each data row, so header index == data-cell index.
 *
 * Returns { natural95, diesel, station } or null (and a reason via `onMiss`).
 */
function parsePrices(html, stationName = STATION_ROW, onMiss = () => {}) {
  try {
    const $ = cheerio.load(html);
    const table = $('table.cenik').first();
    if (!table.length) { onMiss('table.cenik not found'); return null; }

    let natural95Col = -1;
    let dieselCol = -1;
    table.find('tr').first().find('th').each((i, th) => {
      const src = $(th).find('img').attr('src') || '';
      if (/n95_c\.gif/.test(src)) natural95Col = i;
      else if (/\/d_c\.gif/.test(src)) dieselCol = i;
    });
    if (natural95Col === -1 || dieselCol === -1) { onMiss('fuel columns not found'); return null; }

    const rows = [];
    table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (!cells.length) return;
      rows.push({
        name: cells.eq(0).text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim(),
        natural95: parsePrice(cells.eq(natural95Col).text()),
        diesel: parsePrice(cells.eq(dieselCol).text()),
      });
    });

    const want = normName(stationName);
    const row =
      rows.find((r) => normName(r.name) === want) ||
      rows.find((r) => normName(r.name).startsWith(want));
    if (!row) {
      onMiss('station "' + stationName + '" not in ceník (' + rows.length + ' rows: ' +
        rows.slice(0, 8).map((r) => r.name).join(', ') + '…)');
      return null;
    }
    if (row.natural95 == null || row.diesel == null) {
      onMiss('station "' + row.name + '" has no N95/diesel price');
      return null;
    }
    return { natural95: row.natural95, diesel: row.diesel, station: row.name };
  } catch (err) {
    onMiss('parse error: ' + err.message);
    return null;
  }
}

async function fetchPrices() {
  const res = await axios.get(CENIK_URL, { timeout: 15000, headers: { 'User-Agent': UA } });
  const prices = parsePrices(res.data, STATION_ROW, (why) => console.error('[tank-ono] ' + why));
  return prices;
}

module.exports = { fetchPrices, parsePrices, KEY, STATION_ROW };
