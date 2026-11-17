const axios = require('axios');
const cheerio = require('cheerio');

const CITY = 'usti-nad-labem';
const N95_URL = `https://www.mbenzin.cz/Nejlevnejsi-benzin/${CITY}`;
const DIESEL_URL = `https://www.mbenzin.cz/Nejlevnejsi-nafta/${CITY}`;
const UA = 'Mozilla/5.0 (compatible; DejnyHlidac/2.0; +https://beno.dejny.eu)';

function parsePrice(raw) {
  const cleaned = (raw || '').trim().replace(',', '.').replace(/[^\d.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) || value === 0 ? null : value;
}

/**
 * Since Aug 2026 mbenzin serves a JavaScript "Ověřuji prohlížeč…" gate to
 * non-browser clients and asks scripts to request an access key at
 * https://www.mbenzin.cz/klic. We detect the gate instead of mis-parsing it.
 */
function isGatePage(html) {
  return /Ověřuji prohlížeč|\/_vratna\/|mbenzin\.cz\/klic/.test(String(html || '')) &&
    !/itemtype="http:\/\/www\.data-vocabulary\.org\/LocalBusiness"/.test(String(html || ''));
}

/**
 * Each station is a microdata block: itemtype .../LocalBusiness with an
 * [itemprop="name"] and a <meta itemprop="@id" content="12345">. The price
 * sits in a div immediately after a label div reading "Cena benzínu" (N95)
 * or "Cena nafty" (Diesel).
 */
function parseListing(html, fuelKey) {
  const $ = cheerio.load(html);
  const out = [];
  $('[itemtype="http://www.data-vocabulary.org/LocalBusiness"]').each((_, el) => {
    const card = $(el);
    const name = card.find('[itemprop="name"]').first().text().trim();
    const id = card.find('meta[itemprop="@id"]').attr('content');
    if (!name || !id) return;
    const street = card.find('[itemprop="streetAddress"]').first().text().trim();
    let price = null;
    card.find('.text-muted.font-s-07r').each((__, lbl) => {
      const label = $(lbl).text().trim();
      if (label === 'Cena benzínu' || label === 'Cena nafty') {
        price = parsePrice($(lbl).next().text());
      }
    });
    out.push({ id: String(id), name, street, [fuelKey]: price });
  });
  return out;
}

function joinFuels(n95List, dieselList) {
  const byId = new Map();
  for (const s of n95List) byId.set(s.id, { id: s.id, name: s.name, street: s.street, natural95: s.natural95, diesel: null });
  for (const s of dieselList) {
    const entry = byId.get(s.id) || { id: s.id, name: s.name, street: s.street, natural95: null, diesel: null };
    entry.diesel = s.diesel;
    byId.set(s.id, entry);
  }
  return [...byId.values()].filter(
    (s) => s.natural95 != null && s.diesel != null && s.name !== 'Tank ONO'
  );
}

// Optional access credentials once mbenzin issues a key (see README):
//   MBENZIN_COOKIE="name=value"  -> sent as Cookie header
//   MBENZIN_QUERY="klic=XYZ"     -> appended to the listing URLs
function withAccess(url) {
  const q = process.env.MBENZIN_QUERY;
  if (!q) return url;
  return url + (url.includes('?') ? '&' : '?') + q.replace(/^[?&]/, '');
}

async function fetchListing(url, fuelKey) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'cs' };
  if (process.env.MBENZIN_COOKIE) headers.Cookie = process.env.MBENZIN_COOKIE;
  const res = await axios.get(withAccess(url), { timeout: 15000, headers });
  if (isGatePage(res.data)) {
    const err = new Error('mbenzin bot gate (needs access key — https://www.mbenzin.cz/klic)');
    err.code = 'GATED';
    throw err;
  }
  return parseListing(res.data, fuelKey);
}

async function fetchStations() {
  const [n95, diesel] = await Promise.all([
    fetchListing(N95_URL, 'natural95'),
    fetchListing(DIESEL_URL, 'diesel'),
  ]);
  return joinFuels(n95, diesel);
}

module.exports = { parseListing, joinFuels, fetchStations, isGatePage, CITY };
