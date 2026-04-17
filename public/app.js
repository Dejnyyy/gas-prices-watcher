let chart;

// ── Count-up animation (ease-out-quart) ──
function countUp(el, target, duration = 1500) {
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = (target * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = target.toFixed(2);
  };
  requestAnimationFrame(tick);
}

async function loadLatest() {
  try {
    const res = await fetch('/api/latest');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.natural95) return;

    countUp(document.getElementById('price-natural95'), parseFloat(data.natural95));
    countUp(document.getElementById('price-diesel'),    parseFloat(data.diesel), 1700);

    if (data.checked_at) {
      const d = new Date(data.checked_at);
      document.getElementById('last-update').textContent =
        'Aktualizováno: ' + d.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
    }
  } catch (err) {
    console.error('loadLatest:', err);
  }
}

function createCell(text, mono) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// ── Intersection observer that animates table rows in a stagger ──
function observeTableRows() {
  const tbody = document.getElementById('history-body');
  if (!tbody) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const rows = Array.from(entry.target.querySelectorAll('tbody tr'));
        rows.forEach((row, i) => {
          setTimeout(() => row.classList.add('row-in'), i * 25);
        });
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.04 }
  );

  observer.observe(document.querySelector('.table-wrap'));
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history?days=365');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();

    // Badge count
    const countEl = document.getElementById('row-count');
    if (countEl) countEl.textContent = rows.length + ' záznamů';

    // ── Build table (newest first) ──
    const tbody = document.getElementById('history-body');
    tbody.replaceChildren();

    const reversed = [...rows].reverse();
    reversed.forEach((r, displayIdx) => {
      const tr = document.createElement('tr');

      const dt = new Date(r.checked_at);
      const dateStr = dt.toLocaleString('cs-CZ', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Prague',
      });

      tr.appendChild(createCell(dateStr));
      tr.appendChild(createCell(parseFloat(r.natural95).toFixed(2)));
      tr.appendChild(createCell(parseFloat(r.diesel).toFixed(2)));

      // Status: show Kč diff vs previous record
      const statusTd = document.createElement('td');
      const origIdx = rows.length - 1 - displayIdx;
      const prev = origIdx > 0 ? rows[origIdx - 1] : null;

      if (prev && r.changed) {
        const dn = Math.round((parseFloat(r.natural95) - parseFloat(prev.natural95)) * 100) / 100;
        const dd = Math.round((parseFloat(r.diesel)    - parseFloat(prev.diesel))    * 100) / 100;
        const fmt = (v) => (v > 0 ? '+' : '') + v.toFixed(2);
        const col = (v) => v > 0 ? '#f87171' : v < 0 ? '#4ade80' : 'var(--muted2)';

        const mkSpan = (val) => {
          const s = document.createElement('span');
          s.textContent = fmt(val);
          s.style.fontFamily = "'DM Mono', monospace";
          s.style.fontSize = '.76rem';
          s.style.color = col(val);
          return s;
        };
        const sep = document.createElement('span');
        sep.textContent = '/';
        sep.style.color = 'var(--muted)';
        sep.style.margin = '0 5px';
        sep.style.fontSize = '.7rem';

        statusTd.appendChild(mkSpan(dn));
        statusTd.appendChild(sep);
        statusTd.appendChild(mkSpan(dd));
      } else {
        const same = document.createElement('span');
        same.className = 'badge-same';
        same.textContent = '—';
        statusTd.appendChild(same);
      }
      tr.appendChild(statusTd);
      tbody.appendChild(tr);
    });

    observeTableRows();

    // ── Chart ──
    const labels = rows.map((r) => {
      const d = new Date(r.checked_at);
      return d.toLocaleString('cs-CZ', {
        day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Prague',
      });
    });

    const ctx = document.getElementById('priceChart').getContext('2d');
    if (chart) chart.destroy();

    const makeGradient = (color) => (scriptCtx) => {
      const { ctx: c, chartArea } = scriptCtx.chart;
      if (!chartArea) return color;
      const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      g.addColorStop(0, color.replace(')', ', .20)').replace('rgb', 'rgba'));
      g.addColorStop(1, color.replace(')', ', 0)').replace('rgb', 'rgba'));
      return g;
    };

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Natural 95',
            data: rows.map((r) => parseFloat(r.natural95)),
            borderColor: '#166534',
            backgroundColor: (sc) => {
              const { ctx: c, chartArea } = sc.chart;
              if (!chartArea) return 'rgba(22,101,52,.06)';
              const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              g.addColorStop(0, 'rgba(22,101,52,.12)');
              g.addColorStop(1, 'rgba(22,101,52,.0)');
              return g;
            },
            borderWidth: 2,
            tension: 0.42,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#166534',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
          },
          {
            label: 'Diesel',
            data: rows.map((r) => parseFloat(r.diesel)),
            borderColor: '#1e3a8a',
            backgroundColor: (sc) => {
              const { ctx: c, chartArea } = sc.chart;
              if (!chartArea) return 'rgba(30,58,138,.06)';
              const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              g.addColorStop(0, 'rgba(30,58,138,.1)');
              g.addColorStop(1, 'rgba(30,58,138,.0)');
              return g;
            },
            borderWidth: 2,
            tension: 0.42,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#1e3a8a',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1600, easing: 'easeInOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: '#9e998f',
              font: { family: "'DM Mono', monospace", size: 11 },
              boxWidth: 20,
              boxHeight: 2,
              padding: 16,
              usePointStyle: false,
            },
          },
          tooltip: {
            backgroundColor: '#ffffff',
            borderColor: '#dedad4',
            borderWidth: 1,
            titleColor: '#9e998f',
            titleFont: { family: "'DM Mono', monospace", size: 10 },
            bodyColor: '#111110',
            bodyFont: { family: "'DM Mono', monospace", size: 12 },
            padding: 12,
            caretSize: 4,
            callbacks: {
              label: (ctx) => '  ' + ctx.dataset.label + '  ' + ctx.parsed.y.toFixed(2) + ' Kč',
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#c4bfb8',
              font: { family: "'DM Mono', monospace", size: 10 },
              maxTicksLimit: 7,
              maxRotation: 0,
            },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            beginAtZero: false,
            position: 'left',
            ticks: {
              color: '#c4bfb8',
              font: { family: "'DM Mono', monospace", size: 10 },
              callback: (v) => v.toFixed(2),
              maxTicksLimit: 5,
            },
            grid: { color: 'rgba(0,0,0,.04)' },
            border: { display: false },
          },
        },
      },
    });
  } catch (err) {
    console.error('loadHistory:', err);
  }
}

// ── Subscribe form ──
document.getElementById('subscribe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('sub-email').value.trim();
  const msg   = document.getElementById('sub-message');
  const btn   = e.target.querySelector('button');

  msg.className = 'sub-message';
  msg.textContent = '';
  btn.disabled = true;

  try {
    const res  = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) {
      msg.classList.add('success');
      msg.textContent = 'Přihlášení úspěšné! Budete dostávat upozornění na změny cen.';
      e.target.reset();
    } else {
      msg.classList.add('error');
      msg.textContent = 'Chyba: ' + data.error;
    }
  } catch {
    msg.classList.add('error');
    msg.textContent = 'Nastala chyba. Zkuste to znovu.';
  } finally {
    btn.disabled = false;
  }
});

loadLatest();
loadHistory();
