const { Resend } = require('resend');
const db = require('./db');
const { STATIONS, FUELS, ALL_PREFS } = require('./stations');
const { flattenChanges, filterForPrefs, buildHeadline, price, signed, arrow } = require('./changes');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Dejnyho Hlídač <hlidac@dejny.eu>';

const C = {
  down: '#15803d', downBg: '#dcfce7',
  up: '#dc2626', upBg: '#fee2e2',
  ink: '#16181d', muted: '#6b7280', line: '#e5e7eb', bg: '#ffffff', soft: '#f6f7f9',
  accent: '#f97316',
};
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

function changeRow(i) {
  const down = i.delta < 0;
  const col = down ? C.down : C.up;
  const bg = down ? C.downBg : C.upBg;
  const cls = down ? 'dn' : 'up';
  return `
  <tr>
    <td class="row" style="padding:12px 0;border-bottom:1px solid ${C.line};vertical-align:middle">
      <div class="ink" style="font:600 15px/1.25 ${SANS};color:${C.ink}">${escapeHtml(i.label)}</div>
      <div class="muted" style="font:500 12px/1.4 ${SANS};color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${escapeHtml(i.fuelLabel)}</div>
    </td>
    <td class="row" align="right" style="padding:12px 0;border-bottom:1px solid ${C.line};vertical-align:middle;white-space:nowrap">
      <span class="muted" style="font:400 13px ${MONO};color:${C.muted};text-decoration:line-through">${price(i.old)}</span>
      <span class="muted" style="font:400 13px ${MONO};color:${C.muted}">&nbsp;→&nbsp;</span>
      <span class="ink" style="font:700 20px ${MONO};color:${C.ink}">${price(i.new)}</span>
      <span class="muted" style="font:400 12px ${SANS};color:${C.muted}">&nbsp;Kč</span>
    </td>
    <td class="row" align="right" style="padding:12px 0 12px 10px;border-bottom:1px solid ${C.line};vertical-align:middle;white-space:nowrap;width:1%">
      <span class="chip ${cls}" style="display:inline-block;padding:4px 9px;border-radius:999px;background:${bg};color:${col};font:700 13px ${MONO}">${arrow(i.delta)}&nbsp;${signed(i.delta)}</span>
    </td>
  </tr>`;
}

// Small "current prices" grid for the subscriber's stations × fuels.
function currentTable(latest, prefs) {
  const stations = STATIONS.filter((s) => prefs.stations.includes(s.slug) && latest[s.slug]);
  const fuels = FUELS.filter((f) => prefs.fuels.includes(f.key));
  if (!stations.length) return '';
  const min = {};
  for (const f of fuels) {
    const vals = stations.map((s) => latest[s.slug][f.key]).filter((v) => v != null);
    min[f.key] = vals.length > 1 ? Math.min(...vals) : null;
  }
  const head = fuels.map((f) =>
    `<td align="right" class="muted" style="padding:0 0 6px 12px;font:600 11px ${SANS};color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${f.label}</td>`
  ).join('');
  const rows = stations.map((s) => {
    const cells = fuels.map((f) => {
      const v = latest[s.slug][f.key];
      const best = min[f.key] != null && v === min[f.key] && stations.filter((x) => latest[x.slug][f.key] === v).length === 1;
      return `<td align="right" class="ink" style="padding:5px 0 5px 12px;font:${best ? 700 : 400} 14px ${MONO};color:${C.ink};white-space:nowrap">${v != null ? price(v) : '—'}${best ? `<span style="color:${C.down}">&nbsp;●</span>` : ''}</td>`;
    }).join('');
    return `<tr><td class="ink" style="padding:5px 0;font:500 14px ${SANS};color:${C.ink}">${escapeHtml(s.label)}</td>${cells}</tr>`;
  }).join('');
  return `
  <tr><td style="padding:22px 0 0">
    <div class="muted" style="font:600 11px ${SANS};color:${C.muted};text-transform:uppercase;letter-spacing:.08em;padding-bottom:8px">Aktuální ceny (Kč/l)</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td></td>${head}</tr>${rows}
    </table>
  </td></tr>`;
}

// One closing sentence: where it is cheaper right now (the only "commentary").
function cheaperNote(latest, prefs) {
  const st = STATIONS.filter((s) => prefs.stations.includes(s.slug) && latest[s.slug]);
  if (st.length < 2) return '';
  const notes = FUELS.filter((f) => prefs.fuels.includes(f.key)).map((f) => {
    const [a, b] = st;
    const va = latest[a.slug][f.key];
    const vb = latest[b.slug][f.key];
    if (va == null || vb == null) return null;
    if (va === vb) return f.label + ' stojí stejně';
    const cheap = va < vb ? a : b;
    return f.label + ' je levnější v ' + (cheap.slug === 'makro' ? 'Makru' : 'Tank ONO') + ' o ' + price(Math.abs(va - vb)) + ' Kč';
  }).filter(Boolean);
  return notes.length ? notes.join(', ') + '.' : '';
}

/**
 * items: per-fuel changes already filtered for this recipient.
 * opts: { baseUrl, email, token?, latest, prefs, now? }
 */
function buildEmailHtml(items, { baseUrl, email, token, latest = {}, prefs = ALL_PREFS, now = new Date() }) {
  const headline = buildHeadline(items);
  const manage = token ? baseUrl + '/manage.html?token=' + token : null;
  const unsub = token ? baseUrl + '/unsubscribe?token=' + token : null;
  const note = cheaperNote(latest, prefs);
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(headline)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    body, .bg { background:#111317 !important; }
    .ink { color:#f3f4f6 !important; }
    .muted { color:#9ca3af !important; }
    .row { border-color:#2a2e36 !important; }
    .chip.dn { background:#14532d !important; color:#86efac !important; }
    .chip.up { background:#7f1d1d !important; color:#fca5a5 !important; }
    .btn { background:#f97316 !important; }
  }
  @media (max-width:480px) { .wrap { padding:0 14px 40px !important; } }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.bg}" bgcolor="${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(headline)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}"><tr>
<td align="center" class="wrap" style="padding:0 20px 48px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px">
    <tr><td style="height:4px;background:${C.accent};font-size:0;line-height:0" bgcolor="${C.accent}">&nbsp;</td></tr>
    <tr><td style="padding:18px 0 6px">
      <span class="muted" style="font:600 12px ${SANS};color:${C.muted};letter-spacing:.04em">DEJNYHO HLÍDAČ</span>
      <span class="muted" style="font:400 12px ${MONO};color:${C.muted};float:right">${formatDate(now)}</span>
    </td></tr>
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items.map(changeRow).join('')}</table>
    </td></tr>
    ${currentTable(latest, prefs)}
    ${note ? `<tr><td class="muted" style="padding:18px 0 0;font:400 14px/1.5 ${SANS};color:${C.muted}">${escapeHtml(note)}</td></tr>` : ''}
    <tr><td style="padding:22px 0 26px">
      <a class="btn" href="${baseUrl}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;font:600 14px ${SANS};padding:11px 20px;border-radius:10px">Graf a historie →</a>
    </td></tr>
    <tr><td class="row muted" style="border-top:1px solid ${C.line};padding-top:14px;font:400 12px/1.6 ${SANS};color:${C.muted}">
      Pro ${escapeHtml(email)}${manage ? ` · <a href="${manage}" class="muted" style="color:${C.muted};text-decoration:underline">upravit odběr</a> · <a href="${unsub}" class="muted" style="color:${C.muted};text-decoration:underline">odhlásit</a>` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function buildText(items, { baseUrl, token, latest, prefs }) {
  const lines = items.map((i) =>
    i.label + ' · ' + i.fuelLabel + ': ' + price(i.old) + ' → ' + price(i.new) + ' Kč (' + signed(i.delta) + ')');
  const note = cheaperNote(latest || {}, prefs || ALL_PREFS);
  return lines.join('\n') + (note ? '\n\n' + note : '') + '\n\n' + baseUrl +
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
  sendNotification, buildMessage, buildEmailHtml, buildSubject, recipientsFor, cheaperNote, resend,
};
