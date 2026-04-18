const { Resend } = require('resend');
const db = require('./db');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(date) {
  return date.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildSubject(oldPrices, newPrices) {
  const dn = Math.round((newPrices.natural95 - oldPrices.natural95) * 100) / 100;
  const dd = Math.round((newPrices.diesel    - oldPrices.diesel)    * 100) / 100;
  const fmt = (v) => (v > 0 ? '↑' : '↓') + Math.abs(v).toFixed(2);
  const parts = [];
  if (dn !== 0) parts.push('Natural ' + fmt(dn));
  if (dd !== 0) parts.push('Diesel ' + fmt(dd));
  const summary = parts.length ? parts.join(', ') : 'změna cen';
  return 'Dejnyho Hlídač — ' + summary + ' Kč';
}

function diffColor(v) {
  if (v > 0) return '#b91c1c';
  if (v < 0) return '#15803d';
  return '#6b7280';
}

function diffArrow(v) {
  if (v > 0) return '↑';
  if (v < 0) return '↓';
  return '—';
}

function buildEmailHtml(oldPrices, newPrices, baseUrl, recipientEmail) {
  const unsubLink = baseUrl + '/unsubscribe?email=' + encodeURIComponent(recipientEmail);
  const siteLink  = baseUrl;
  const now       = formatDate(new Date());

  const fuels = [
    { label: 'Natural 95', color: '#166534', old: oldPrices.natural95, new: newPrices.natural95 },
    { label: 'Diesel',     color: '#1e3a8a', old: oldPrices.diesel,    new: newPrices.diesel },
  ];

  let fuelBlocks = '';
  for (const f of fuels) {
    const diff    = Math.round((f.new - f.old) * 100) / 100;
    const dCol    = diff > 0 ? '#991b1b' : diff < 0 ? '#14532d' : '#6b7280';
    const dBg     = diff > 0 ? '#fef2f2' : diff < 0 ? '#f0fdf4' : '#f5f5f4';
    const dBorder = diff > 0 ? '#fecaca' : diff < 0 ? '#bbf7d0' : '#e7e5e4';
    const dArrow  = diff > 0 ? '↑' : diff < 0 ? '↓' : '—';
    const dStr    = diff === 0 ? 'beze změny' : (diff > 0 ? '+' : '') + diff.toFixed(2) + ' Kč';

    fuelBlocks += `
      <tr>
        <td style="padding-bottom:10px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#ffffff;border:1px solid #d1d5db;border-radius:12px;border-left:4px solid ${f.color}"
                 bgcolor="#ffffff">
            <tr>
              <td style="padding:16px 20px 0 20px">
                <span style="font-family:'SF Mono','Consolas','Monaco',monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#374151;font-weight:600">${f.label}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 20px 0 20px">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:bottom">
                      <div style="font-size:11px;color:#6b7280;margin-bottom:4px">bylo</div>
                      <div style="font-family:'SF Mono','Consolas','Monaco',monospace;font-size:16px;color:#9ca3af;text-decoration:line-through">${f.old.toFixed(2)} Kč</div>
                    </td>
                    <td style="vertical-align:bottom;text-align:right">
                      <div style="font-size:11px;color:#6b7280;margin-bottom:4px;text-align:right">nová cena</div>
                      <div style="line-height:1">
                        <span style="font-family:'SF Mono','Consolas','Monaco',monospace;font-size:34px;font-weight:700;color:${f.color}">${f.new.toFixed(2)}</span>
                        <span style="font-family:'SF Mono','Consolas','Monaco',monospace;font-size:16px;color:#374151;margin-left:4px">Kč</span>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 20px 14px 20px;border-top:1px solid #e5e7eb">
                <table cellpadding="0" cellspacing="0" border="0" align="right">
                  <tr>
                    <td style="background:${dBg};border:1px solid ${dBorder};border-radius:999px;padding:4px 12px" bgcolor="${dBg}">
                      <span style="font-family:'SF Mono','Consolas','Monaco',monospace;font-size:12px;font-weight:600;color:${dCol}">${dArrow} ${dStr}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Dejnyho Hlídač — změna cen</title>
  <style>
    :root { color-scheme: light only; }
    @media (prefers-color-scheme: dark) {
      body, table, td, th, div, span, a, p { background-color: #ffffff !important; color: #111110 !important; }
      .card { background-color: #ffffff !important; border-color: #d1d5db !important; }
      .muted { color: #6b7280 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#111110;color-scheme:light;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif" bgcolor="#ffffff">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff">
    <tr>
      <td align="center" style="padding:0 16px 56px">

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">

          <!-- Amber top bar -->
          <tr>
            <td style="height:3px;background:#b45309;border-radius:0 0 3px 3px" bgcolor="#b45309"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:28px 0 20px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size:20px;font-weight:700;color:#111110;letter-spacing:-.3px">Dejnyho Hlídač<span style="color:#b45309">.</span></span>
                  </td>
                  <td align="right" style="vertical-align:middle">
                    <span style="display:inline-block;background:#fef3c7;border:1px solid #fde68a;border-radius:999px;padding:3px 11px;font-family:'SF Mono','Consolas','Monaco',monospace;font-size:9px;letter-spacing:2px;color:#b45309;text-transform:uppercase">změna cen</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding-bottom:18px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:1px;background:#dedad4" bgcolor="#dedad4"></td></tr>
              </table>
            </td>
          </tr>

          <!-- Timestamp -->
          <tr>
            <td style="padding-bottom:18px">
              <span style="font-family:'SF Mono','Consolas','Monaco',monospace;font-size:11px;color:#6b7280">${now}</span>
            </td>
          </tr>

          <!-- Fuel blocks -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${fuelBlocks}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding-top:6px;padding-bottom:28px">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#b45309;border-radius:8px" bgcolor="#b45309">
                    <a href="${siteLink}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:.2px;padding:11px 22px">Zobrazit přehled &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding-bottom:16px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:1px;background:#dedad4" bgcolor="#dedad4"></td></tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td>
              <span style="font-size:11px;color:#6b7280;font-family:'SF Mono','Consolas','Monaco',monospace">${recipientEmail}</span>
              <span style="font-size:11px;color:#9ca3af;margin:0 6px">&middot;</span>
              <a href="${unsubLink}" style="font-size:11px;color:#374151;font-family:'SF Mono','Consolas','Monaco',monospace;text-decoration:underline">odhlásit</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

async function sendNotification(oldPrices, newPrices) {
  const subscribers = await db.getSubscribers();
  const owner   = process.env.NOTIFY_EMAIL;
  const baseUrl = process.env.BASE_URL;

  if (!baseUrl) {
    console.error('BASE_URL not set — cannot send notifications');
    return;
  }

  const recipients = [...new Set([owner, ...subscribers])].filter(Boolean);
  const subject    = buildSubject(oldPrices, newPrices);

  for (const email of recipients) {
    try {
      await resend.emails.send({
        from: 'Dejnyho Hlídač <noreply@dejny.eu>',
        to:   email,
        subject,
        html: buildEmailHtml(oldPrices, newPrices, baseUrl, email),
      });
    } catch (err) {
      console.error('Failed to send email to ' + email + ':', err.message);
    }
  }
}

module.exports = { sendNotification, buildEmailHtml, buildSubject };
