/* Dejnyho Hlídač — dashboard */
(() => {
  'use strict';

  const TZ = 'Europe/Prague';
  const STALE_MIN = 20;
  const SLUG = 'tank-ono';
  const LABEL = 'Tank ONO Teplice';
  const FUELS = [
    { key: 'natural95', label: 'Natural 95' },
    { key: 'diesel', label: 'Nafta' },
  ];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const fmt = (v) => Number(v).toFixed(2).replace('.', ',');
  const minutesAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;

  function relTime(iso) {
    const mins = Math.round(minutesAgo(iso));
    if (mins < 1) return 'právě teď';
    if (mins < 60) return 'před ' + mins + ' min';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return 'před ' + hrs + ' h';
    const days = Math.round(hrs / 24);
    return days === 1 ? 'včera' : 'před ' + days + ' dny';
  }
  const dayMonth = (iso) => new Date(iso).toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric' });
  const dateTime = (iso) => new Date(iso).toLocaleString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  const time = (iso) => new Date(iso).toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const isToday = (iso) => dayMonth(iso) === dayMonth(new Date().toISOString());
  const when = (iso) => (isToday(iso) ? 'dnes ' : dayMonth(iso) + ' ') + time(iso);

  // ── Theme (light by default, manual switch) ──

  let chart = null;
  function applyTheme(t, animate) {
    if (animate && !reduceMotion) {
      document.body.classList.add('theming');
      setTimeout(() => document.body.classList.remove('theming'), 260);
    }
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0b0b0b' : '#ffffff');
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
    try { localStorage.setItem('theme', t); } catch (e) { /* private mode */ }
    if (chart) { chart.destroy(); chart = null; renderChart(); }
  }
  document.querySelectorAll('[data-theme-set]').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.themeSet, true));
  });
  document.querySelectorAll('[data-theme-set]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.themeSet === document.documentElement.getAttribute('data-theme'))));

  // ── Latest prices: station block, last check ──

  let latest = null;

  function isStale(s) { return !s.available || minutesAgo(s.checked_at) > STALE_MIN; }

  function renderStation(s) {
    const root = $('#totem-' + s.slug);
    if (!root) return;
    const rows = $('.rows', root);
    const foot = $('.station-foot', root);
    root.classList.toggle('is-stale', s.available && isStale(s));
    const prev = [...rows.querySelectorAll('.row-price')].map((n) => n.dataset.v || '');
    rows.replaceChildren();

    FUELS.forEach((f, idx) => {
      const r = el('div', 'row');
      r.appendChild(el('span', 'row-fuel', f.label));

      const move = el('span', 'row-move');
      const m = s.lastMoveByFuel && s.lastMoveByFuel[f.key];
      if (m) move.textContent = (m.delta < 0 ? '↓ ' : '↑ ') + fmt(Math.abs(m.delta)) + ' Kč, ' + dayMonth(m.at);
      else move.textContent = s.available ? 'beze změny' : '';
      r.appendChild(move);

      const price = el('span', 'row-price');
      if (s.available) {
        const v = fmt(s[f.key]);
        price.dataset.v = v;
        price.appendChild(document.createTextNode(v));
        price.appendChild(el('small', null, 'Kč'));
        if (prev[idx] !== v) price.classList.add('is-fresh');
      } else {
        price.classList.add('is-empty');
        price.textContent = '—';
      }
      r.appendChild(price);
      rows.appendChild(r);
    });

    if (!s.available) foot.textContent = 'Zatím bez dat';
    else if (isStale(s)) foot.textContent = 'Cena ověřena ' + when(s.checked_at);
    else foot.textContent = 'Ověřeno ' + relTime(s.checked_at);
  }

  function renderPulse() {
    const p = $('#pulse');
    const txt = $('#pulse-text');
    if (!latest || !latest.available) { txt.textContent = 'Bez dat'; p.classList.add('is-stale'); return; }
    const newest = latest.checked_at;
    const stale = minutesAgo(newest) > STALE_MIN;
    p.classList.toggle('is-stale', stale);
    txt.textContent = (stale ? 'Poslední kontrola ' : 'Kontrola ') + when(newest);
  }

  async function loadLatest() {
    try {
      const res = await fetch('/api/stations/latest', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { stations } = await res.json();
      latest = stations.find((s) => s.slug === SLUG) || null;
      if (latest) renderStation(latest);
      renderPulse();
    } catch (err) {
      console.error('loadLatest:', err);
      $('#pulse-text').textContent = 'Ceny se nepodařilo načíst';
      $('#pulse').classList.add('is-stale');
    }
  }

  // ── History: chart + change table ──

  let history = null;
  const view = { fuel: 'natural95', days: 90 };

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function buildChanges() {
    const list = [];
    const rows = history || [];
    for (let i = 1; i < rows.length; i++) {
      // After an observation gap (scraper down) the moment of change is unknown.
      if (rows[i].gap) continue;
      for (const f of FUELS) {
        const from = Number(rows[i - 1][f.key]);
        const to = Number(rows[i][f.key]);
        if (from !== to) {
          list.push({ fuel: f, from, to, delta: Math.round((to - from) * 100) / 100, at: rows[i].checked_at });
        }
      }
    }
    return list.reverse();
  }

  let shown = 12;
  function renderChanges() {
    const all = buildChanges();
    const body = $('#changes');
    body.replaceChildren();
    const n = all.length;
    $('#history-count').textContent = n ? n + (n === 1 ? ' změna' : n < 5 ? ' změny' : ' změn') + ' za rok' : '';
    if (!n) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Za poslední rok se ceny nezměnily.');
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    all.slice(0, shown).forEach((c) => {
      const tr = el('tr');
      const w = el('td', 'when');
      w.appendChild(document.createTextNode(dayMonth(c.at) + ' '));
      w.appendChild(el('span', 't', time(c.at)));
      tr.appendChild(w);
      tr.appendChild(el('td', 'fuel', c.fuel.label));
      tr.appendChild(el('td', 'num was', fmt(c.from)));
      tr.appendChild(el('td', 'num now', fmt(c.to)));
      const down = c.delta < 0;
      tr.appendChild(el('td', 'num delta ' + (down ? 'dn' : 'up'), (down ? '↓ ' : '↑ ') + fmt(Math.abs(c.delta))));
      body.appendChild(tr);
    });
    $('#history-more').hidden = n <= shown;
  }

  function series() {
    const rows = history || [];
    const pts = [];
    rows.forEach((r, i) => {
      const x = new Date(r.checked_at).getTime();
      // Break the line across an observation gap instead of dating the change.
      if (r.gap && i > 0) pts.push({ x: new Date(rows[i - 1].checked_at).getTime() + 1, y: null });
      pts.push({ x, y: Number(r[view.fuel]) });
    });
    return pts;
  }

  function renderChart() {
    if (!window.Chart || !history) return;
    const canvas = $('#priceChart');
    const min = Date.now() - view.days * 86400000;
    const ink = cssVar('--ink');
    const bg = cssVar('--bg');
    const muted = cssVar('--muted');
    const line = cssVar('--line');
    const font = "'Archivo', 'Helvetica Neue', Arial, sans-serif";

    const color = cssVar('--ono-line');
    const ds = [{
      label: FUELS.find((f) => f.key === view.fuel).label,
      data: series(),
      borderColor: color,
      backgroundColor: color,
      fill: false,
      stepped: 'before',
      spanGaps: false,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: bg,
      pointHoverBorderWidth: 2,
      pointStyle: 'rect',
    }];

    // Y range from what is visible: points inside the window + the value entering it.
    const allY = ds.flatMap((d) => {
      const inside = d.data.filter((p) => p.x >= min);
      const before = d.data.filter((p) => p.x < min).pop();
      return (before ? [before, ...inside] : inside).map((p) => p.y).filter((y) => y != null);
    });
    const yMin = allY.length ? Math.floor(Math.min(...allY) - 0.3) : undefined;
    const yMax = allY.length ? Math.ceil(Math.max(...allY) + 0.3) : undefined;

    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion ? false : { duration: 300 },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: ink,
          titleColor: bg,
          bodyColor: bg,
          cornerRadius: 2,
          caretSize: 0,
          titleFont: { family: font, size: 12, weight: '500' },
          bodyFont: { family: font, size: 14, weight: '800' },
          padding: 10,
          boxWidth: 10,
          boxHeight: 10,
          boxPadding: 4,
          callbacks: {
            title: (items) => items.length ? dateTime(new Date(items[0].parsed.x).toISOString()) : '',
            label: (c) => ' ' + c.dataset.label + '  ' + fmt(c.parsed.y) + ' Kč',
            labelColor: (c) => ({ borderColor: c.dataset.borderColor, backgroundColor: c.dataset.borderColor, borderWidth: 0 }),
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min,
          max: Date.now(),
          ticks: {
            color: muted,
            font: { family: font, size: 12 },
            maxRotation: 0,
            autoSkipPadding: 20,
            maxTicksLimit: 7,
            callback: (v) => new Date(v).toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric' }),
          },
          grid: { display: false },
          border: { color: ink },
        },
        y: {
          position: 'right',
          min: yMin, max: yMax,
          ticks: { color: muted, font: { family: font, size: 12 }, callback: (v) => fmt(v), maxTicksLimit: 6, padding: 8 },
          grid: { color: line, drawTicks: false },
          border: { display: false },
        },
      },
    };

    if (chart) {
      chart.data.datasets = ds;
      chart.options = opts;
      chart.update();
    } else {
      chart = new Chart(canvas.getContext('2d'), { type: 'line', data: { datasets: ds }, options: opts });
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/history?station=' + SLUG + '&days=365', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      history = await res.json();
      renderChanges();
      renderChart();
    } catch (err) {
      console.error('loadHistory:', err);
    }
  }

  document.querySelectorAll('.seg button').forEach((b) => {
    b.addEventListener('click', () => {
      const group = b.parentElement;
      group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (b.dataset.fuel) view.fuel = b.dataset.fuel;
      if (b.dataset.days) view.days = Number(b.dataset.days);
      renderChart();
    });
  });
  $('#history-more').addEventListener('click', () => { shown += 20; renderChanges(); });

  // ── Preferences (shared by e-mail + push) ──

  function getPrefs() {
    return { fuels: [...document.querySelectorAll('input[name="fuels"]:checked')].map((i) => i.value) };
  }
  function setPrefs(p) {
    document.querySelectorAll('input[name="fuels"]').forEach((i) => { i.checked = p.fuels.includes(i.value); });
  }
  function validPrefs() {
    const p = getPrefs();
    const hint = $('#choice-hint');
    if (!p.fuels.length) {
      hint.textContent = 'Vyber aspoň jedno palivo.';
      return null;
    }
    hint.textContent = '';
    return p;
  }
  function say(node, text, kind) {
    node.className = 'msg' + (kind ? ' ' + kind : '');
    node.textContent = text;
  }

  $('#subscribe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#sub-email');
    const msg = $('#sub-message');
    const btn = e.target.querySelector('button');
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say(msg, 'Zadej celý e-mail, třeba jan@seznam.cz.', 'err'); input.focus(); return; }
    const prefs = validPrefs();
    if (!prefs) return;
    btn.disabled = true;
    say(msg, '');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ...prefs }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        say(msg, 'Hotovo. Nastavení změníš nebo odběr zrušíš odkazem v každém e-mailu.', 'ok');
        e.target.reset();
      } else if (res.status === 429) {
        say(msg, 'Moc pokusů za sebou. Zkus to za minutu.', 'err');
      } else {
        say(msg, data.error || 'Přihlášení se nepovedlo. Zkus to znovu.', 'err');
      }
    } catch {
      say(msg, 'Bez připojení k serveru. Zkus to znovu.', 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Push notifications ──

  (function initPush() {
    const block = $('#push-block');
    const toggle = $('#push-toggle');
    const label = $('#push-toggle-label');
    const save = $('#push-save');
    const msg = $('#push-message');
    const iosHint = $('#push-ios-hint');
    if (!('serviceWorker' in navigator)) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const swReady = navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.error('SW registration failed:', err);
      return null;
    });

    if (!('PushManager' in window) || !('Notification' in window)) {
      if (isIos && !isStandalone) { block.hidden = false; toggle.hidden = true; iosHint.hidden = false; }
      return;
    }
    block.hidden = false;
    if (isIos && !isStandalone) iosHint.hidden = false;

    let endpoint = null;
    let savedPrefs = null;

    function setState(on) {
      label.textContent = on ? 'Vypnout notifikace' : 'Zapnout notifikace v telefonu';
      toggle.dataset.on = on ? '1' : '';
      if (!on) save.hidden = true;
    }
    const same = (a, b) => a && b && a.fuels.join() === b.fuels.join();
    document.querySelectorAll('.choice input').forEach((i) => i.addEventListener('change', () => {
      validPrefs();
      if (endpoint) save.hidden = same(getPrefs(), savedPrefs);
    }));

    function b64ToBytes(s) {
      const pad = '='.repeat((4 - (s.length % 4)) % 4);
      const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
    }
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // Restore state: existing browser subscription -> load its prefs from the server.
    swReady.then(async (reg) => {
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setState(false); return; }
      endpoint = sub.endpoint;
      setState(true);
      try {
        const st = await (await post('/api/push/status', { endpoint })).json();
        if (st.subscribed) {
          savedPrefs = { fuels: st.fuels };
          setPrefs(savedPrefs);
        } else {
          // Browser still subscribed but server forgot it: re-register with current choice.
          savedPrefs = getPrefs();
          await post('/api/push/subscribe', { subscription: sub.toJSON(), ...savedPrefs });
        }
      } catch { /* non-fatal */ }
    });

    save.addEventListener('click', async () => {
      const prefs = validPrefs();
      if (!prefs || !endpoint) return;
      save.disabled = true;
      try {
        const res = await post('/api/push/prefs', { endpoint, ...prefs });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        savedPrefs = prefs;
        save.hidden = true;
        say(msg, 'Výběr pro notifikace uložen.', 'ok');
      } catch {
        say(msg, 'Výběr se nepovedlo uložit. Zkus to znovu.', 'err');
      } finally {
        save.disabled = false;
      }
    });

    toggle.addEventListener('click', async () => {
      say(msg, '');
      toggle.disabled = true;
      try {
        const reg = await swReady;
        if (!reg) throw new Error('prohlížeč nepodporuje service worker');
        const existing = await reg.pushManager.getSubscription();

        if (existing) {
          await post('/api/push/unsubscribe', { endpoint: existing.endpoint });
          await existing.unsubscribe();
          endpoint = null; savedPrefs = null;
          setState(false);
          say(msg, 'Notifikace vypnuté.', 'ok');
          return;
        }

        const prefs = validPrefs();
        if (!prefs) return;
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          say(msg, 'Notifikace jsou v prohlížeči zablokované. Povol je v nastavení webu.', 'err');
          return;
        }
        const keyRes = await fetch('/api/push/public-key');
        if (!keyRes.ok) throw new Error('server nemá nastavené notifikace');
        const { key } = await keyRes.json();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
        const saveRes = await post('/api/push/subscribe', { subscription: sub.toJSON(), ...prefs });
        if (!saveRes.ok) throw new Error('uložení na server selhalo');
        endpoint = sub.endpoint; savedPrefs = prefs;
        setState(true);
        say(msg, 'Notifikace zapnuté. Přijdou při každé změně, kterou sleduješ.', 'ok');
      } catch (err) {
        console.error(err);
        say(msg, 'Notifikace se nepodařilo zapnout: ' + err.message + '.', 'err');
      } finally {
        toggle.disabled = false;
      }
    });
  })();

  // ── Boot + refresh ──

  loadLatest();
  // Chart.js is deferred like this script; wait for it (and the web font, so the canvas axes use it).
  const fontsReady = () => (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());
  const boot = () => fontsReady().then(loadHistory);
  if (window.Chart) boot();
  else window.addEventListener('load', boot, { once: true });

  setInterval(loadLatest, 60_000);
  setInterval(loadHistory, 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { loadLatest(); loadHistory(); }
  });
})();
