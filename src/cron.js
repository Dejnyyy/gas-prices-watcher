const cron = require('node-cron');
const { scrapeAll } = require('./scrapers/index');
const db = require('./db');
const { sendNotification } = require('./notifier');
const { sendPriceChangePush } = require('./push');
const { STATIONS } = require('./stations');

let checking = false;

async function runCheck() {
  if (checking) {
    console.log('Previous check still running, skipping.');
    return;
  }
  checking = true;
  try {
    await _runCheck();
  } finally {
    checking = false;
  }
}

async function _runCheck() {
  const now = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
  console.log('[' + now + '] Running price check...');

  let scraped;
  try {
    scraped = await scrapeAll();
  } catch (err) {
    console.error('scrapeAll error:', err.message);
    return;
  }
  if (!scraped.length) {
    console.error('No stations scraped — skipping.');
    return;
  }

  const changes = [];
  const latest = {}; // slug -> current prices, for the "aktuální ceny" part of messages

  for (const s of scraped) {
    try {
      const stationId = await db.upsertStation(s);
      const [last, prev] = await db.getLatest2ForStation(stationId);

      const latN = last ? parseFloat(last.natural95) : null;
      const latD = last ? parseFloat(last.diesel) : null;
      const priceChanged = !last || latN !== s.natural95 || latD !== s.diesel;
      latest[s.slug] = { natural95: s.natural95, diesel: s.diesel };

      if (priceChanged) {
        if (last) {
          changes.push({
            slug: s.slug, name: s.name, label: s.label,
            old: { natural95: latN, diesel: latD },
            new: { natural95: s.natural95, diesel: s.diesel },
          });
        }
        await db.saveCheck(stationId, { natural95: s.natural95, diesel: s.diesel }, true);
      } else {
        // Keep only [last change, latest tick]: drop the previous unchanged tick.
        const prevSame = prev && parseFloat(prev.natural95) === latN && parseFloat(prev.diesel) === latD;
        if (prevSame) await db.deleteRecord(last.id);
        await db.saveCheck(stationId, { natural95: s.natural95, diesel: s.diesel }, false);
      }
    } catch (err) {
      console.error('Station ' + s.slug + ' error:', err.message);
    }
  }

  if (!changes.length) {
    console.log('No changes this cycle.');
    return;
  }

  // Stations that failed to scrape this cycle still get their last known price
  // in the "current prices" overview.
  for (const st of STATIONS) {
    if (latest[st.slug]) continue;
    try {
      const row = await db.getStationBySlug(st.slug);
      const last = row && (await db.getLatestForStation(row.id));
      if (last) latest[st.slug] = { natural95: parseFloat(last.natural95), diesel: parseFloat(last.diesel) };
    } catch { /* overview is best-effort */ }
  }

  console.log('Changes: ' + changes.map((c) => c.slug).join(', '));
  try {
    const { sent, skipped } = await sendNotification(changes, { latest });
    console.log('E-mail sent to ' + sent + ' recipients (' + skipped + ' not interested).');
  } catch (err) {
    console.error('Notification error:', err.message);
  }
  try {
    const { sent, pruned, skipped } = await sendPriceChangePush(changes, { latest });
    console.log('Push sent to ' + sent + ' subscriptions (' + skipped + ' not interested, ' + pruned + ' pruned).');
  } catch (err) {
    console.error('Push error:', err.message);
  }
}

function startCron() {
  cron.schedule('*/5 * * * *', runCheck);
  console.log('Cron started — checking every 5 minutes.');
}

module.exports = { startCron, runCheck };
