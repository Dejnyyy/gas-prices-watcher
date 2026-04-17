const { Resend } = require('resend');
const db = require('./db');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(date) {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return { date: `${d}.${m}.${y}`, time: `${hh}:${mm}` };
}

function buildSubject(date) {
  const { date: d, time: t } = formatDate(date);
  return `Zmena cen Tank ONO - ${d} ${t}`;
}

function fmtDiff(oldVal, newVal) {
  const diff = Math.round((newVal - oldVal) * 100) / 100;
  if (diff === 0) return '—';
  return diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
}

function buildEmailHtml(oldPrices, newPrices, baseUrl, recipientEmail) {
  const rows = [
    { label: 'Natural 95', old: oldPrices.natural95, new: newPrices.natural95 },
    { label: 'Diesel',     old: oldPrices.diesel,    new: newPrices.diesel },
    { label: 'LPG',        old: oldPrices.lpg,       new: newPrices.lpg },
  ];

  const unsubLink = baseUrl + '/unsubscribe?email=' + encodeURIComponent(recipientEmail);

  let tableRows = '';
  for (const r of rows) {
    tableRows +=
      '<tr>' +
      '<td style="padding:6px 12px">' + r.label + '</td>' +
      '<td style="padding:6px 12px">' + r.old.toFixed(2) + ' Kc</td>' +
      '<td style="padding:6px 12px"><strong>' + r.new.toFixed(2) + ' Kc</strong></td>' +
      '<td style="padding:6px 12px">' + fmtDiff(r.old, r.new) + '</td>' +
      '</tr>';
  }

  return (
    '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">' +
    '<h2>Zmena cen Tank ONO</h2>' +
    '<p>Ceny pohonnych hmot na Tank ONO se zmenily.</p>' +
    '<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">' +
    '<thead><tr style="background:#f0f0f0">' +
    '<th style="padding:6px 12px;text-align:left">Palivo</th>' +
    '<th style="padding:6px 12px;text-align:left">Stara cena</th>' +
    '<th style="padding:6px 12px;text-align:left">Nova cena</th>' +
    '<th style="padding:6px 12px;text-align:left">Rozdil</th>' +
    '</tr></thead>' +
    '<tbody>' + tableRows + '</tbody>' +
    '</table>' +
    '<p style="margin-top:24px;font-size:12px;color:#999">' +
    'For: ' + recipientEmail + '<br />' +
    '<a href="' + unsubLink + '">unsubscribe</a>' +
    '</p>' +
    '</body></html>'
  );
}

async function sendNotification(oldPrices, newPrices) {
  const subscribers = await db.getSubscribers();
  const owner = process.env.NOTIFY_EMAIL;
  const baseUrl = process.env.BASE_URL;
  const recipients = [...new Set([owner, ...subscribers])].filter(Boolean);
  const subject = buildSubject(new Date());

  for (const email of recipients) {
    try {
      const hostname = new URL(baseUrl).hostname;
      await resend.emails.send({
        from: 'Tank ONO Watcher <noreply@' + hostname + '>',
        to: email,
        subject,
        html: buildEmailHtml(oldPrices, newPrices, baseUrl, email),
      });
    } catch (err) {
      console.error('Failed to send email to ' + email + ':', err.message);
    }
  }
}

module.exports = { sendNotification, buildEmailHtml, buildSubject };
