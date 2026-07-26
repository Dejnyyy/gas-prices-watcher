const { Resend } = require('resend');
const db = require('./db');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date) {
  return date.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fuelDelta(oldV, newV) {
  return Math.round((newV - oldV) * 100) / 100;
}

function buildSubject(changes) {
  if (!changes || !changes.length) return 'Dejnyho Hlídač — změna cen';
  const parts = changes.map((c) => {
    const dn = fuelDelta(c.old.natural95, c.new.natural95);
    const dd = fuelDelta(c.old.diesel, c.new.diesel);
    const biggest = Math.abs(dn) >= Math.abs(dd) ? dn : dd;
    const dir = biggest > 0 ? '↑' : '↓';
    return c.name + ' ' + dir + Math.abs(biggest).toFixed(2).replace('.', ',');
  });
  return 'Dejnyho Hlídač — ' + parts.join(', ');
}

function fuelRow(label, color, oldV, newV) {
  const diff = fuelDelta(oldV, newV);
  const dCol = diff > 0 ? '#991b1b' : diff < 0 ? '#14532d' : '#6b7280';
  const dBg = diff > 0 ? '#fef2f2' : diff < 0 ? '#f0fdf4' : '#f5f5f4';
  const dBorder = diff > 0 ? '#fecaca' : diff < 0 ? '#bbf7d0' : '#e7e5e4';
  const dArrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '—';
  const dStr = diff === 0 ? 'beze změny' : (diff > 0 ? '+' : '') + diff.toFixed(2).replace('.', ',') + ' Kč';
  return `
    <tr>
      <td style="padding:6px 0">
        <span style="font-family:'SF Mono','Consolas',monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#374151;font-weight:600">${label}</span>
      </td>
      <td style="padding:6px 0;text-align:right">
        ${diff !== 0 ? `<span style="font-family:'SF Mono','Consolas',monospace;font-size:14px;color:#9ca3af;text-decoration:line-through;margin-right:8px">${oldV.toFixed(2).replace('.', ',')}</span>` : ''}
        <span style="font-family:'SF Mono','Consolas',monospace;font-size:22px;font-weight:700;color:${color}">${newV.toFixed(2).replace('.', ',')}</span>
        <span style="font-family:'SF Mono','Consolas',monospace;font-size:13px;color:#374151"> Kč</span>
      </td>
      <td style="padding:6px 0 6px 10px;text-align:right">
        <span style="display:inline-block;background:${dBg};border:1px solid ${dBorder};border-radius:999px;padding:3px 10px;font-family:'SF Mono','Consolas',monospace;font-size:11px;font-weight:600;color:${dCol}">${dArrow} ${dStr}</span>
      </td>
    </tr>`;
}

function stationBlock(change) {
  const rows =
    fuelRow('Natural 95', '#166534', change.old.natural95, change.new.natural95) +
    fuelRow('Diesel', '#1e3a8a', change.old.diesel, change.new.diesel);
  return `
    <tr><td style="padding-bottom:12px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #d1d5db;border-radius:12px;border-left:4px solid #b45309" bgcolor="#ffffff">
        <tr><td style="padding:14px 18px 4px 18px">
          <span style="font-size:15px;font-weight:700;color:#111110">${escapeHtml(change.name)}</span>
        </td></tr>
        <tr><td style="padding:0 18px 10px 18px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
        </td></tr>
      </table>
    </td></tr>`;
}

function buildDigestHtml(changes, baseUrl, recipientEmail) {
  const unsubLink = baseUrl + '/unsubscribe?email=' + encodeURIComponent(recipientEmail);
  const now = formatDate(new Date());
  const blocks = changes.map(stationBlock).join('');

  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" /><title>Dejnyho Hlídač — změna cen</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#111110;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif" bgcolor="#ffffff">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"><tr>
    <td align="center" style="padding:0 16px 56px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
        <tr><td style="height:3px;background:#b45309;border-radius:0 0 3px 3px" bgcolor="#b45309"></td></tr>
        <tr><td style="padding:26px 0 8px">
          <span style="font-size:20px;font-weight:700;color:#111110">Dejnyho Hlídač<span style="color:#b45309">.</span></span>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">Změna cen — ${changes.length} ${changes.length === 1 ? 'stanice' : 'stanic'}</div>
        </td></tr>
        <tr><td style="padding:6px 0 16px"><span style="font-family:'SF Mono','Consolas',monospace;font-size:11px;color:#6b7280">${now}</span></td></tr>
        <tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0">${blocks}</table></td></tr>
        <tr><td style="padding-top:6px;padding-bottom:20px">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:#b45309;border-radius:8px" bgcolor="#b45309">
              <a href="${baseUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:13px;font-weight:500;padding:11px 22px">Zobrazit přehled &rarr;</a>
            </td></tr></table>
        </td></tr>
        <tr><td style="border-top:1px solid #dedad4;padding-top:14px">
          <span style="font-size:11px;color:#6b7280;font-family:'SF Mono','Consolas',monospace">${recipientEmail}</span>
          <span style="font-size:11px;color:#9ca3af;margin:0 6px">&middot;</span>
          <a href="${unsubLink}" style="font-size:11px;color:#374151;font-family:'SF Mono','Consolas',monospace;text-decoration:underline">odhlásit</a>
        </td></tr>
      </table>
    </td></tr></table>
</body></html>`;
}

async function sendNotification(changes) {
  const subscribers = await db.getSubscribers();
  const owner = process.env.NOTIFY_EMAIL;
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.error('BASE_URL not set — cannot send notifications');
    return;
  }
  const recipients = [...new Set([owner, ...subscribers])].filter(Boolean);
  const subject = buildSubject(changes);

  for (const email of recipients) {
    try {
      await resend.emails.send({
        from: 'Dejnyho Hlídač <hlidac@dejny.eu>',
        to: email,
        subject,
        html: buildDigestHtml(changes, baseUrl, email),
      });
    } catch (err) {
      console.error('Failed to send email to ' + email + ':', err.message);
    }
  }
}

module.exports = { sendNotification, buildDigestHtml, buildSubject };
