const axios = require('axios');
const cheerio = require('cheerio');

const CITY = 'usti-nad-labem';
const N95_URL = `https://www.mbenzin.cz/Nejlevnejsi-benzin/${CITY}`;
const DIESEL_URL = `https://www.mbenzin.cz/Nejlevnejsi-nafta/${CITY}`;
const UA = 'Mozilla/5.0 (compatible; DejnyHlidac/1.0; +https://beno.dejny.eu)';

function parsePrice(raw) {
  const cleaned = (raw || '').trim().replace(',', '.').replace(/[^\d.]/g, '');
  const value = parseFloat(cleaned);
  return isNaN(value) || value === 0 ? null : value;
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
    let price = null;
    card.find('.text-muted.font-s-07r').each((__, lbl) => {
      const label = $(lbl).text().trim();
      if (label === 'Cena benzínu' || label === 'Cena nafty') {
        price = parsePrice($(lbl).next().text());
      }
    });
    out.push({ id: String(id), name, [fuelKey]: price });
  });
  return out;
}

function joinFuels(n95List, dieselList) {
  const byId = new Map();
  for (const s of n95List) byId.set(s.id, { id: s.id, name: s.name, natural95: s.natural95, diesel: null });
  for (const s of dieselList) {
    const entry = byId.get(s.id) || { id: s.id, name: s.name, natural95: null, diesel: null };
    entry.diesel = s.diesel;
    byId.set(s.id, entry);
  }
  return [...byId.values()].filter(
    (s) => s.natural95 != null && s.diesel != null && s.name !== 'Tank ONO'
  );
}

async function fetchStations() {
  const opts = { timeout: 10000, headers: { 'User-Agent': UA } };
  const [n95, diesel] = await Promise.all([
    axios.get(N95_URL, opts).then((r) => parseListing(r.data, 'natural95')),
    axios.get(DIESEL_URL, opts).then((r) => parseListing(r.data, 'diesel')),
  ]);
  return joinFuels(n95, diesel);
}

module.exports = { parseListing, joinFuels, fetchStations, CITY };
