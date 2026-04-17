const cron = require('node-cron');
const { fetchPrices } = require('./scraper');
const db = require('./db');
const { sendNotification } = require('./notifier');

async function runCheck() {
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
    const latest = await db.getLatest();
    let changed = false;

    if (latest) {
      const oldPrices = {
        natural95: parseFloat(latest.natural95),
        diesel: parseFloat(latest.diesel),
      };
      changed =
        oldPrices.natural95 !== prices.natural95 ||
        oldPrices.diesel !== prices.diesel;

      if (changed) {
        await sendNotification(oldPrices, prices);
      }
    }

    await db.saveCheck(prices, changed);
    console.log('Saved. Changed: ' + changed + '. Prices:', prices);
  } catch (err) {
    console.error('DB/notifier error:', err.message);
  }
}

function startCron() {
  cron.schedule('*/5 * * * *', runCheck);
  console.log('Cron started — checking every 5 minutes.');
}

module.exports = { startCron, runCheck };
