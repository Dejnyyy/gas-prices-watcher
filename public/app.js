/* Dejnyho Hlídač — dashboard */
(() => {
  'use strict';

  const TZ = 'Europe/Prague';
  const STALE_MIN = 20;
  const COMPARE_MAX_H = 36; // older prices are not used for "cheaper" comparisons
  const FUELS = [
    { key: 'natural95', label: 'Natural 95', lower: 'Natural 95' },
    { key: 'diesel', label: 'Nafta', lower: 'nafta' },
  ];
  const STATIONS = {
    'tank-ono': { label: 'Tank ONO Teplice', short: 'Tank ONO', at: 'na Tank ONO', cls: 'v-ono', cssVar: '--ono' },
    makro: { label: 'Makro Trmice', short: 'Makro', at: 'v Makru', cls: 'v-makro', cssVar: '--makro' },
  };
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

  function countUp(node, target, delay = 0) {
    if (reduceMotion) { node.textContent = fmt(target); return; }
    const from = Math.max(0, target - 4);
    const dur = 900;
    let start;
    const tick = (now) => {
      if (start == null) start = now + delay;
      const t = Math.min(Math.max((now - start) / dur, 0), 1);
      const e = 1 - Math.pow(1 - t, 4);
      node.textContent = fmt(from + (target - from) * e);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── Latest prices: totems, verdict, pulse ──

  let latest = null;
  let firstRender = true;

  function isStale(s) { return !s.available || minutesAgo(s.checked_at) > STALE_MIN; }

  function cheaperOf(fuel) {
    const a = latest['tank-ono'];
    const b = latest.makro;
    if (!a || !b || !a.available || !b.available) return null;
    if (minutesAgo(a.checked_at) > COMPARE_MAX_H * 60 || minutesAgo(b.checked_at) > COMPARE_MAX_H * 60) return null;
    const d = Math.round((a[fuel] - b[fuel]) * 100) / 100;
    if (d === 0) return { same: true };
    return { slug: d < 0 ? 'tank-ono' : 'makro', diff: Math.abs(d) };
  }

  function renderTotem(s) {
    const root = $('#totem-' + s.slug);
    if (!root) return;
    const panels = $('.totem-panels', root);
    const foot = $('.totem-foot', root);
    root.classList.toggle('is-stale', isStale(s));
    panels.replaceChildren();

    FUELS.forEach((f, idx) => {
      const p = el('div', 'panel');
      const head = el('div', 'panel-fuel');
      head.appendChild(el('span', null, f.label));
      const c = cheaperOf(f.key);
      if (c && !c.same && c.slug === s.slug) {
        p.classList.add('is-best');
        head.appendChild(el('span', 'panel-best', 'levněji o ' + fmt(c.diff)));
      }
      p.appendChild(head);

      const price = el('div', 'panel-price');
      const num = el('span', null, s.available ? fmt(s[f.key]) : '—');
      price.appendChild(num);
      price.appendChild(el('small', null, 'Kč'));
      p.appendChild(price);

      const move = el('p', 'panel-move');
      const m = s.lastMoveByFuel && s.lastMoveByFuel[f.key];
      if (m) {
        const b = el('b', m.delta < 0 ? 'dn' : 'up', (m.delta < 0 ? '↓ ' : '↑ ') + fmt(Math.abs(m.delta)));
        move.appendChild(b);
        move.appendChild(document.createTextNode(' Kč, ' + dayMonth(m.at)));
      } else {
        move.textContent = s.available ? 'zatím beze změny' : 'bez dat';
      }
      p.appendChild(move);
      panels.appendChild(p);

      if (s.available && firstRender) countUp(num, s[f.key], idx * 120);
    });

    if (!s.available) foot.textContent = 'Zatím žádná data.';
    else if (isStale(s)) foot.textContent = 'Poslední údaj ' + dateTime(s.checked_at) + ', zdroj teď neodpovídá.';
    else foot.textContent = 'Ověřeno ' + relTime(s.checked_at);
  }

  function renderVerdict() {
    const v = $('#verdict');
    v.replaceChildren();
    const parts = [];
    for (const f of FUELS) {
      const c = cheaperOf(f.key);
      if (!c) continue;
      parts.push({ f, c });
    }
    if (!parts.length) {
      // No fair comparison possible: state the fresh station's prices instead.
      const fresh = Object.entries(latest).filter(([, s]) => s.available && minutesAgo(s.checked_at) <= COMPARE_MAX_H * 60);
      const old = Object.entries(latest).filter(([, s]) => !fresh.some(([k]) => k === s.slug));
      if (fresh.length) {
        const [slug, s] = fresh[0];
        v.appendChild(el('span', STATIONS[slug].cls, STATIONS[slug].label));
        v.appendChild(document.createTextNode(': Natural 95 za ' + fmt(s.natural95) + ' Kč, nafta za ' + fmt(s.diesel) + ' Kč.'));
      } else {
        v.textContent = 'Ceny Tank ONO Teplice a Makro Trmice, kontrola každých 5 minut.';
      }
      old.forEach(([slug, s]) => {
        v.appendChild(el('span', 'v-sub', s.available
          ? 'Makro teď nemá čerstvou cenu (poslední z ' + dateTime(s.checked_at) + '), proto ho nesrovnávám.'.replace('Makro', slug === 'makro' ? 'Makro' : 'Tank ONO')
          : (slug === 'makro' ? 'Makro' : 'Tank ONO') + ' zatím nemá žádnou cenu.'));
      });
      return;
    }
    const sameStation = parts.length === 2 && !parts[0].c.same && !parts[1].c.same && parts[0].c.slug === parts[1].c.slug;
    if (sameStation) {
      const st = STATIONS[parts[0].c.slug];
      v.appendChild(document.createTextNode('Obojí teď natankuješ levněji '));
      v.appendChild(el('span', st.cls, st.at));
      v.appendChild(document.createTextNode(': Natural 95 o ' + fmt(parts[0].c.diff) + ' Kč, nafta o ' + fmt(parts[1].c.diff) + ' Kč.'));
    } else {
      parts.forEach(({ f, c }, i) => {
        const lead = i === 0 ? f.label : f.lower;
        if (c.same) {
          v.appendChild(document.createTextNode(lead + ' stojí na obou stejně'));
        } else {
          const st = STATIONS[c.slug];
          v.appendChild(document.createTextNode(lead + ' je levnější '));
          v.appendChild(el('span', st.cls, st.at));
          v.appendChild(document.createTextNode(' o ' + fmt(c.diff) + ' Kč'));
        }
        v.appendChild(document.createTextNode(i === parts.length - 1 ? '.' : ', '));
      });
    }
    const stale = Object.entries(latest).filter(([, s]) => s.available && isStale(s));
    if (stale.length) {
      const [slug, s] = stale[0];
      v.appendChild(el('span', 'v-sub', 'Cena ' + (slug === 'makro' ? 'Makra' : 'Tank ONO') + ' je z ' + dateTime(s.checked_at) + ', srovnání nemusí sedět.'));
    }
  }

  function renderPulse() {
    const p = $('#pulse');
    const t = $('#pulse-text');
    const times = Object.values(latest).filter((s) => s.available).map((s) => new Date(s.checked_at).getTime());
    if (!times.length) { t.textContent = 'bez dat'; p.classList.add('is-stale'); return; }
    const newest = new Date(Math.max(...times)).toISOString();
    const stale = minutesAgo(newest) > STALE_MIN;
    p.classList.toggle('is-stale', stale);
    t.textContent = (stale ? 'poslední kontrola ' : 'kontrola ') + (minutesAgo(newest) < 60 ? relTime(newest) : time(newest));
  }

  async function loadLatest() {
    try {
      const res = await fetch('/api/stations/latest', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { stations } = await res.json();
      latest = Object.fromEntries(stations.map((s) => [s.slug, s]));
      stations.forEach(renderTotem);
      renderVerdict();
      renderPulse();
      firstRender = false;
    } catch (err) {
      console.error('loadLatest:', err);
      $('#pulse-text').textContent = 'ceny se nepodařilo načíst';
      $('#pulse').classList.add('is-stale');
    }
  }

  // ── History: chart + change list ──

  let history = null;
  let chart = null;
  const view = { fuel: 'natural95', days: 90 };

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function buildChanges() {
    const list = [];
    for (const [slug, rows] of Object.entries(history || {})) {
      for (let i = 1; i < rows.length; i++) {
        for (const f of FUELS) {
          const from = Number(rows[i - 1][f.key]);
          const to = Number(rows[i][f.key]);
          if (from !== to) {
            list.push({ slug, fuel: f, from, to, delta: Math.round((to - from) * 100) / 100, at: rows[i].checked_at });
          }
        }
      }
    }
    return list.sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  let shown = 12;
  function renderChanges() {
    const all = buildChanges();
    const ol = $('#changes');
    ol.replaceChildren();
    $('#history-count').textContent = all.length ? all.length + (all.length === 1 ? ' změna' : all.length < 5 ? ' změny' : ' změn') + ' za rok' : '';
    if (!all.length) {
      ol.appendChild(el('li', 'changes-empty', 'Za poslední rok se ceny nezměnily.'));
    }
    all.slice(0, shown).forEach((c) => {
      const li = el('li', 'change');
      const when = el('span', 'change-when');
      when.appendChild(document.createTextNode(dayMonth(c.at)));
      when.appendChild(el('br'));
      when.appendChild(document.createTextNode(time(c.at)));
      li.appendChild(when);

      const what = el('span', 'change-what');
      const st = el('span', 'st');
      const sw = el('i', 'sw ' + (c.slug === 'makro' ? 'sw-makro' : 'sw-ono'));
      st.appendChild(sw);
      st.appendChild(document.createTextNode(STATIONS[c.slug].short));
      what.appendChild(st);
      what.appendChild(el('span', 'fuel', ' ' + c.fuel.lower));
      const pr = el('span', 'prices');
      pr.appendChild(el('s', null, fmt(c.from)));
      pr.appendChild(document.createTextNode(' → ' + fmt(c.to) + ' Kč'));
      what.appendChild(pr);
      li.appendChild(what);

      const down = c.delta < 0;
      li.appendChild(el('span', 'chip ' + (down ? 'dn' : 'up'), (down ? '↓ ' : '↑ ') + fmt(Math.abs(c.delta))));
      ol.appendChild(li);
    });
    const more = $('#history-more');
    more.hidden = all.length <= shown;
  }

  function seriesFor(slug) {
    const rows = (history && history[slug]) || [];
    return rows.map((r) => ({ x: new Date(r.checked_at).getTime(), y: Number(r[view.fuel]) }));
  }

  function renderChart() {
    if (!window.Chart || !history) return;
    const canvas = $('#priceChart');
    const min = Date.now() - view.days * 86400000;
    const ink2 = cssVar('--ink-2');
    const muted = cssVar('--muted');
    const line = cssVar('--line');
    const surface = cssVar('--surface');

    const ds = Object.keys(STATIONS).map((slug) => {
      const color = cssVar(STATIONS[slug].cssVar);
      return {
        label: STATIONS[slug].label,
        data: seriesFor(slug),
        borderColor: color,
        backgroundColor: (sc) => {
          const { ctx, chartArea } = sc.chart;
          if (!chartArea) return 'transparent';
          const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, color + '33');
          g.addColorStop(1, color + '00');
          return g;
        },
        fill: 'origin',
        stepped: 'before',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: surface,
        pointHoverBorderWidth: 2,
      };
    });

    // Y range from what is visible: points inside the window + the value entering it.
    const allY = ds.flatMap((d) => {
      const inside = d.data.filter((p) => p.x >= min);
      const before = d.data.filter((p) => p.x < min).pop();
      return (before ? [before, ...inside] : inside).map((p) => p.y);
    });
    const yMin = allY.length ? Math.min(...allY) - 0.4 : undefined;
    const yMax = allY.length ? Math.max(...allY) + 0.4 : undefined;

    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: chart || reduceMotion ? { duration: reduceMotion ? 0 : 450 } : { duration: 1100, easing: 'easeOutQuart' },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: surface,
          borderColor: line,
          borderWidth: 1,
          titleColor: muted,
          bodyColor: cssVar('--ink'),
          titleFont: { family: 'Bricolage Grotesque', size: 11, weight: '500' },
          bodyFont: { family: 'Bricolage Grotesque', size: 13, weight: '600' },
          padding: 10,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            title: (items) => items.length ? dateTime(new Date(items[0].parsed.x).toISOString()) : '',
            label: (c) => ' ' + c.dataset.label + '  ' + fmt(c.parsed.y) + ' Kč',
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
            font: { family: 'Bricolage Grotesque', size: 11 },
            maxRotation: 0,
            autoSkipPadding: 18,
            maxTicksLimit: 7,
            callback: (v) => new Date(v).toLocaleDateString('cs-CZ', { timeZone: TZ, day: 'numeric', month: view.days > 60 ? 'short' : 'numeric' }),
          },
          grid: { display: false },
          border: { color: line },
        },
        y: {
          suggestedMin: yMin, suggestedMax: yMax,
          ticks: { color: muted, font: { family: 'Barlow Condensed', size: 13, weight: '600' }, callback: (v) => fmt(v), maxTicksLimit: 6 },
          grid: { color: line },
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
      const res = await fetch('/api/history?station=all&days=365', { cache: 'no-store' });
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

  // Re-theme the chart when the OS switches light/dark.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (chart) { chart.destroy(); chart = null; renderChart(); }
  });

  // ── Preferences (shared by e-mail + push) ──

  function getPrefs() {
    const pick = (name) => [...document.querySelectorAll('input[name="' + name + '"]:checked')].map((i) => i.value);
    return { stations: pick('stations'), fuels: pick('fuels') };
  }
  function setPrefs(p) {
    document.querySelectorAll('input[name="stations"]').forEach((i) => { i.checked = p.stations.includes(i.value); });
    document.querySelectorAll('input[name="fuels"]').forEach((i) => { i.checked = p.fuels.includes(i.value); });
  }
  function validPrefs() {
    const p = getPrefs();
    const hint = $('#choice-hint');
    if (!p.stations.length || !p.fuels.length) {
      hint.textContent = !p.stations.length ? 'Vyber aspoň jednu stanici.' : 'Vyber aspoň jedno palivo.';
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
        say(msg, 'Hotovo. Pokud adresa ještě nebyla přihlášená, začnou ti chodit upozornění. Nastavení pak změníš odkazem v e-mailu.', 'ok');
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
    const same = (a, b) => a && b && a.stations.join() === b.stations.join() && a.fuels.join() === b.fuels.join();
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
          savedPrefs = { stations: st.stations, fuels: st.fuels };
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
  // Chart.js is deferred like this script; wait for it if needed.
  if (window.Chart) loadHistory();
  else window.addEventListener('load', loadHistory, { once: true });

  setInterval(loadLatest, 60_000);
  setInterval(loadHistory, 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { loadLatest(); loadHistory(); }
  });
})();
