// Manually records a verified price for a station (e.g. read off the official
// website when the scraper source is blocked). Does NOT send notifications.
//   node scripts/set-price.js tank-ono 37.90 42.90
require('dotenv').config();
const db = require('../src/db');
const { stationBySlug } = require('../src/stations');

(async () => {
  const [slug, n, d] = process.argv.slice(2);
  const cfg = stationBySlug(slug);
  const natural95 = parseFloat(n);
  const diesel = parseFloat(d);
  if (!cfg || !(natural95 > 10) || !(diesel > 10)) {
    throw new Error('usage: node scripts/set-price.js tank-ono <natural95> <diesel>');
  }
  const id = await db.upsertStation(cfg);
  const last = await db.getLatestForStation(id);
  const changed = !last || parseFloat(last.natural95) !== natural95 || parseFloat(last.diesel) !== diesel;
  await db.saveCheck(id, { natural95, diesel }, changed);
  console.log('Saved', slug, { natural95, diesel, changed });
  await db.pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
