const { Resend } = require('resend');
const db = require('./db');
const { STATIONS, FUELS, ALL_PREFS } = require('./stations');
const { flattenChanges, filterForPrefs, buildHeadline, price, signed, arrow } = require('./changes');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Dejnyho Hlídač <hlidac@dejny.eu>';

const C = {
  down: '#15803d', up: '#b91c1c',
  ink: '#0a0a0a', muted: '#6e6e6e', line: '#e2e2e2', bg: '#ffffff',
};
// Brand fill: Tank ONO yellow with black text.
const BRAND = {
  'tank-ono': { bg: '#ffd200', fg: '#0a0a0a', cls: 'b-ono' },
};
const brandOf = (slug) => BRAND[slug] || { bg: C.ink, fg: '#ffffff', cls: '' };
const SANS = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(date) {
  return date.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Backwards-compatible: station-level changes -> subject line (all prefs).
function buildSubject(changes) {
  return buildHeadline(flattenChanges(changes));
}

// One change = brand block (station + fuel) beside the new price.
function changeRow(i) {
  const down = i.delta < 0;
  const br = brandOf(i.slug);
  return `
  <tr><td style="padding:0 0 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="${br.cls}" width="150" bgcolor="${br.bg}" style="width:150px;padding:14px 16px;background:${br.bg};color:${br.fg};vertical-align:top;border-radius:4px 0 0 4px">
        <div class="${br.cls}" style="font:800 17px/1.15 ${SANS};color:${br.fg}">${escapeHtml(i.label)}</div>
        <div class="${br.cls}" style="font:500 14px/1.4 ${SANS};color:${br.fg};padding-top:2px">${escapeHtml(i.fuelLabel)}</div>
      </td>
      <td class="row" style="padding:10px 0 10px 18px;border-top:1px solid ${C.line};border-bottom:1px solid ${C.line};vertical-align:middle">
        <span class="ink" style="font:800 34px/1 ${SANS};color:${C.ink};letter-spacing:-0.02em;white-space:nowrap">${price(i.new)}</span><span class="ink" style="font:500 14px ${SANS};color:${C.ink}">&nbsp;Kč</span>
        <div style="font:500 14px/1.4 ${SANS};padding-top:4px;white-space:nowrap">
          <span class="${down ? 'dn' : 'up'}" style="font-weight:800;color:${down ? C.down : C.up}">${arrow(i.delta)}&nbsp;${signed(i.delta)}</span>
          <span class="muted" style="color:${C.muted}">&nbsp;z ${price(i.old)}</span>
        </div>
      </td>
    </tr></table>
  </td></tr>`;
}

// Small "current prices" grid for the subscriber's stations × fuels.
function currentTable(latest, prefs) {
  const stations = STATIONS.filter((s) => prefs.stations.includes(s.slug) && latest[s.slug]);
  const fuels = FUELS.filter((f) => prefs.fuels.includes(f.key));
  if (!stations.length) return '';
  const head = fuels.map((f) =>
    `<td align="right" class="muted row" style="padding:0 0 6px 12px;border-bottom:1px solid ${C.ink};font:500 13px ${SANS};color:${C.muted}">${f.label}</td>`
  ).join('');
  const rows = stations.map((s) => {
    const br = brandOf(s.slug);
    const cells = fuels.map((f) => {
      const v = latest[s.slug][f.key];
      return `<td align="right" class="ink row" style="padding:9px 0 9px 12px;border-bottom:1px solid ${C.line};font:800 17px ${SANS};color:${C.ink};white-space:nowrap">${v != null ? price(v) : '—'}</td>`;
    }).join('');
    return `<tr><td class="ink row" style="padding:9px 0;border-bottom:1px solid ${C.line};font:500 15px ${SANS};color:${C.ink}"><span class="${br.cls}" style="display:inline-block;width:10px;height:10px;background:${br.bg};margin-right:8px">&nbsp;</span>${escapeHtml(s.label)}</td>${cells}</tr>`;
  }).join('');
  return `
  <tr><td style="padding:24px 0 0">
    <div class="ink" style="font:800 17px ${SANS};color:${C.ink};padding-bottom:8px">Aktuální ceny <span class="muted" style="font-weight:500;color:${C.muted}">Kč/l</span></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="row" style="border-bottom:1px solid ${C.ink}"></td>${head}</tr>${rows}
    </table>
  </td></tr>`;
}

/**
 * items: per-fuel changes already filtered for this recipient.
 * opts: { baseUrl, email, token?, latest, prefs, now? }
 */
function buildEmailHtml(items, { baseUrl, email, token, latest = {}, prefs = ALL_PREFS, now = new Date() }) {
  const headline = buildHeadline(items);
  const manage = token ? baseUrl + '/manage.html?token=' + token : null;
  const unsub = token ? baseUrl + '/unsubscribe?token=' + token : null;
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(headline)}</title>
<style>
  .b-ono { background:#ffd200 !important; color:#0a0a0a !important; }
  @media (prefers-color-scheme: dark) {
    body, .bg { background:#0b0b0b !important; }
    .ink { color:#f2f2f2 !important; }
    .muted { color:#8c8c8c !important; }
    .row { border-color:#2a2a2a !important; }
    .rule { border-color:#f2f2f2 !important; }
    .dn { color:#4ade80 !important; }
    .up { color:#f87171 !important; }
    .btn { background:#f2f2f2 !important; color:#0a0a0a !important; }
  }
  [data-ogsc] .ink { color:#f2f2f2 !important; }
  @media (max-width:480px) { .wrap { padding:0 14px 40px !important; } }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.bg}" bgcolor="${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(headline)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}"><tr>
<td align="center" class="wrap" style="padding:0 20px 48px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px">
    <tr><td class="rule" style="padding:24px 0 12px;border-bottom:2px solid ${C.ink}">
      <span class="ink" style="font:800 16px ${SANS};color:${C.ink}">Dejnyho Hlídač</span>
      <span class="muted" style="font:500 13px ${SANS};color:${C.muted};float:right;padding-top:2px">${formatDate(now)}</span>
    </td></tr>
    <tr><td style="padding:16px 0 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items.map(changeRow).join('')}</table>
    </td></tr>
    ${currentTable(latest, prefs)}
    <tr><td style="padding:24px 0 28px">
      <a class="btn" href="${baseUrl}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;font:800 15px ${SANS};padding:12px 20px;border-radius:4px">Graf a historie cen</a>
    </td></tr>
    <tr><td class="row muted" style="border-top:1px solid ${C.line};padding-top:14px;font:500 13px/1.6 ${SANS};color:${C.muted}">
      Pro ${escapeHtml(email)}${manage ? `. <a href="${manage}" class="muted" style="color:${C.muted};text-decoration:underline">Upravit odběr</a>, <a href="${unsub}" class="muted" style="color:${C.muted};text-decoration:underline">odhlásit</a>` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function buildText(items, { baseUrl, token, latest, prefs }) {
  const lines = items.map((i) =>
    i.label + ' · ' + i.fuelLabel + ': ' + price(i.old) + ' → ' + price(i.new) + ' Kč (' + signed(i.delta) + ')');
  return lines.join('\n') + '\n\n' + baseUrl +
    (token ? '\nUpravit odběr: ' + baseUrl + '/manage.html?token=' + token +
      '\nOdhlásit: ' + baseUrl + '/unsubscribe?token=' + token : '');
}

// Builds the message for one recipient, or null when nothing matches their prefs.
function buildMessage(changes, recipient, { baseUrl, latest = {}, now } = {}) {
  const prefs = { stations: recipient.stations || ALL_PREFS.stations, fuels: recipient.fuels || ALL_PREFS.fuels };
  const items = filterForPrefs(flattenChanges(changes), prefs);
  if (!items.length) return null;
  const opts = { baseUrl, email: recipient.email, token: recipient.token, latest, prefs, now };
  const msg = {
    from: FROM,
    to: recipient.email,
    subject: buildHeadline(items),
    html: buildEmailHtml(items, opts),
    text: buildText(items, opts),
  };
  if (recipient.token) {
    msg.headers = {
      'List-Unsubscribe': '<' + baseUrl + '/unsubscribe?token=' + recipient.token + '>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  return msg;
}

// Owner (NOTIFY_EMAIL) gets everything unless they are also a subscriber with prefs.
function recipientsFor(subscribers, ownerEmail) {
  const list = [...subscribers];
  if (ownerEmail && !list.some((s) => s.email.toLowerCase() === ownerEmail.toLowerCase())) {
    list.unshift({ email: ownerEmail, token: null, ...ALL_PREFS });
  }
  return list;
}

async function sendNotification(changes, { latest = {} } = {}) {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.error('BASE_URL not set — cannot send notifications');
    return { sent: 0, skipped: 0 };
  }
  const recipients = recipientsFor(await db.getSubscribers(), process.env.NOTIFY_EMAIL);
  let sent = 0;
  let skipped = 0;
  for (const r of recipients) {
    const msg = buildMessage(changes, r, { baseUrl, latest });
    if (!msg) { skipped++; continue; }
    try {
      const res = await resend.emails.send(msg);
      if (res && res.error) throw new Error(res.error.message || JSON.stringify(res.error));
      sent++;
    } catch (err) {
      console.error('Failed to send email to ' + r.email + ':', err.message);
    }
  }
  return { sent, skipped };
}

module.exports = {
  sendNotification, buildMessage, buildEmailHtml, buildSubject, recipientsFor, resend,
};
