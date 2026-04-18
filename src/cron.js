const cron = require('node-cron');
const { fetchPrices } = require('./scraper');
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
  console.log('[' + new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) + '] Running price check...');

  let prices;
  try {
    prices = await fetchPrices();
  } catch (err) {
    console.error('Scraper error:', err.message);
    return;
  }

  if (!prices) {
    console.error('Scraper returned null — skipping check.');
    return;
  }

  try {
    const [latest, prev] = await db.getLatest2();

    const priceChanged = !latest ||
      parseFloat(latest.natural95) !== prices.natural95 ||
      parseFloat(latest.diesel)    !== prices.diesel;

    if (priceChanged) {
      const oldPrices = latest
        ? { natural95: parseFloat(latest.natural95), diesel: parseFloat(latest.diesel) }
        : null;
      if (oldPrices) await sendNotification(oldPrices, prices);
      await db.saveCheck(prices, true);
      console.log('Price changed. Saved.', prices);
    } else {
      // Prices unchanged — save latest tick, delete previous if it was also unchanged
      const prevSame = prev &&
        parseFloat(prev.natural95) === parseFloat(latest.natural95) &&
        parseFloat(prev.diesel)    === parseFloat(latest.diesel);

      if (prevSame) {
        await db.deleteRecord(latest.id);
        console.log('No change. Deleted duplicate id=' + latest.id + ', saving new tick.');
      } else {
        console.log('No change. Prev differs (boundary), keeping latest, saving new tick.');
      }
      await db.saveCheck(prices, false);
    }
  } catch (err) {
    console.error('DB/notifier error:', err.message);
  }
}

function startCron() {
  cron.schedule('*/5 * * * *', runCheck);
  console.log('Cron started — checking every 5 minutes.');
}

module.exports = { startCron, runCheck };
