const axios = require('axios');
const cheerio = require('cheerio');

// Makro Ústí nad Labem, Žižkova 3363/78 (on the Trmice boundary) — the only
// Makro in the area.
const STORE_URL = 'https://www.makro.cz/prodejny/usti-nad-labem';
const UA = 'Mozilla/5.0 (compatible; DejnyHlidac/2.0; +https://beno.dejny.eu)';
// A source that refuses us (403 / bot gate) is not retried for this long.
const BLOCKED_COOLDOWN_MS = 60 * 60 * 1000;

function parsePrice(raw) {
  const cleaned = String(raw || '').trim().replace(',', '.').replace(/[^\d.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) || value === 0 ? null : value;
}

/**
 * Official store page: a "Ceny paliv" slider of
 *   .prices .price > .field-name ("Natural 95", "Nafta diesel", "Drive 95", …)
 *                  > .field-price ("37,90")
 * We want plain Natural 95 and plain diesel, never the premium "Drive" ones.
 */
function parseStorePage(html) {
  const $ = cheerio.load(html);
  const out = {};
  $('.prices .price').each((_, el) => {
    const name = $(el).find('.field-name').first().text().replace(/\s+/g, ' ').trim().toLowerCase();
    const price = parsePrice($(el).find('.field-price').first().text());
    if (price == null) return;
    if (/^natural\s*95$/.test(name) && out.natural95 == null) out.natural95 = price;
    else if (/^(nafta|diesel)(\s+diesel)?$/.test(name) && out.diesel == null) out.diesel = price;
  });
  return out.natural95 != null && out.diesel != null ? out : null;
}

const blockedUntil = new Map();

const SOURCES = [
  {
    id: 'makro.cz',
    async fetch() {
      const res = await axios.get(STORE_URL, {
        timeout: 15000,
        headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'cs' },
      });
      const p = parseStorePage(res.data);
      if (!p) throw new Error('fuel price block not found on store page');
      return p;
    },
  },
];

function isBlockedError(err) {
  return err.code === 'GATED' || (err.response && [401, 403, 429].includes(err.response.status));
}

/**
 * Tries each source in order; returns { natural95, diesel, source } or null.
 * `log` receives one line per attempted / skipped source.
 */
async function fetchPrices({ log = console.log, now = Date.now(), sources = SOURCES } = {}) {
  const notes = [];
  for (const src of sources) {
    const until = blockedUntil.get(src.id) || 0;
    if (until > now) {
      notes.push(src.id + ': blocked, retry after ' + new Date(until).toISOString().slice(11, 16) + ' UTC');
      continue;
    }
    try {
      const p = await src.fetch();
      blockedUntil.delete(src.id);
      return { ...p, source: src.id };
    } catch (err) {
      const status = err.response ? 'HTTP ' + err.response.status : err.message;
      if (isBlockedError(err)) blockedUntil.set(src.id, now + BLOCKED_COOLDOWN_MS);
      notes.push(src.id + ': ' + status);
    }
  }
  log('[makro] no source available — ' + notes.join('; '));
  return null;
}

function _resetCooldowns() { blockedUntil.clear(); }

module.exports = { fetchPrices, parseStorePage, SOURCES, STORE_URL, _resetCooldowns };
