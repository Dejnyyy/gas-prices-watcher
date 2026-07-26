const cron = require('node-cron');
const { scrapeAll } = require('./scrapers/index');
const db = require('./db');
const { sendNotification } = require('./notifier');

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

  for (const s of scraped) {
    try {
      const stationId = await db.upsertStation(s);
      const [latest, prev] = await db.getLatest2ForStation(stationId);

      const latN = latest ? parseFloat(latest.natural95) : null;
      const latD = latest ? parseFloat(latest.diesel) : null;
      const priceChanged = !latest || latN !== s.natural95 || latD !== s.diesel;

      if (priceChanged) {
        if (latest) {
          changes.push({
            slug: s.slug, name: s.name,
            old: { natural95: latN, diesel: latD },
            new: { natural95: s.natural95, diesel: s.diesel },
          });
        }
        await db.saveCheck(stationId, { natural95: s.natural95, diesel: s.diesel }, true);
      } else {
        const prevSame = prev && parseFloat(prev.natural95) === latN && parseFloat(prev.diesel) === latD;
        if (prevSame) await db.deleteRecord(latest.id);
        await db.saveCheck(stationId, { natural95: s.natural95, diesel: s.diesel }, false);
      }
    } catch (err) {
      console.error('Station ' + s.slug + ' error:', err.message);
    }
  }

  if (changes.length) {
    try {
      await sendNotification(changes);
      console.log('Notified: ' + changes.map((c) => c.name).join(', '));
    } catch (err) {
      console.error('Notification error:', err.message);
    }
  } else {
    console.log('No changes this cycle.');
  }
}

function startCron() {
  cron.schedule('*/5 * * * *', runCheck);
  console.log('Cron started — checking every 5 minutes.');
}

module.exports = { startCron, runCheck };
