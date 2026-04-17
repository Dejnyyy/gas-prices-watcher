const axios = require('axios');
const cheerio = require('cheerio');

const CENIK_URL = 'https://www.tank-ono.cz/cz/index.php?page=cenik';

/**
 * Parse a CZK price string like "38,90" or "---" into a float or null.
 */
function parsePrice(raw) {
  const cleaned = raw.trim().replace(',', '.').replace(/[^\d.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) || value === 0 ? null : value;
}

/**
 * Parse prices from Tank ONO cenik HTML.
 *
 * The page has a table.cenik where the header row uses <th> with <img> tags
 * whose src identifies the fuel type. Data rows contain one station per row
 * with prices in matching columns. We read column indices from the header,
 * then take the first valid price found in that column across all data rows.
 *
 * Column image patterns:
 *   natural95 → n95_c.gif
 *   diesel    → d_c.gif  (NOT d_plus)
 *   lpg       → lpg_c.gif
 */
function parsePrices(html) {
  try {
    const $ = cheerio.load(html);

    const table = $('table.cenik').first();
    if (!table.length) return null;

    // Determine column indices from header row
    const headerRow = table.find('tr').first();
    const headers = headerRow.find('th');

    let natural95Col = -1;
    let dieselCol = -1;
    let lpgCol = -1;

    headers.each((i, th) => {
      const img = $(th).find('img');
      if (!img.length) return;
      const src = img.attr('src') || '';
      if (/n95_c\.gif/.test(src)) natural95Col = i;
      else if (/\/d_c\.gif/.test(src)) dieselCol = i;
      else if (/lpg_c\.gif/.test(src)) lpgCol = i;
    });

    if (natural95Col === -1 || dieselCol === -1 || lpgCol === -1) return null;

    const prices = {};

    // Iterate data rows (skip header row)
    table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return;

      const tryExtract = (col, key) => {
        if (prices[key] !== undefined) return; // already found
        const cell = cells.eq(col);
        if (!cell.length) return;
        const val = parsePrice(cell.text());
        if (val !== null) prices[key] = val;
      };

      tryExtract(natural95Col, 'natural95');
      tryExtract(dieselCol, 'diesel');
      tryExtract(lpgCol, 'lpg');
    });

    if (prices.natural95 === undefined || prices.diesel === undefined || prices.lpg === undefined) {
      return null;
    }

    return prices;
  } catch {
    return null;
  }
}

async function fetchPrices() {
  try {
    const response = await axios.get(CENIK_URL, { timeout: 10000 });
    return parsePrices(response.data);
  } catch {
    return null;
  }
}

module.exports = { fetchPrices, parsePrices };
