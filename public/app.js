let chart;

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function createCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

async function loadLatest() {
  const res = await fetch('/api/latest');
  const data = await res.json();
  if (!data.natural95) return;
  setText('price-natural95', parseFloat(data.natural95).toFixed(2));
  setText('price-diesel',    parseFloat(data.diesel).toFixed(2));
  setText('price-lpg',       parseFloat(data.lpg).toFixed(2));
}

async function loadHistory() {
  const res = await fetch('/api/history?days=90');
  const rows = await res.json();

  const tbody = document.getElementById('history-body');
  tbody.replaceChildren();
  [...rows].reverse().forEach((r) => {
    const tr = document.createElement('tr');
    tr.appendChild(createCell(new Date(r.checked_at).toLocaleString('cs-CZ')));
    tr.appendChild(createCell(parseFloat(r.natural95).toFixed(2) + ' Kc'));
    tr.appendChild(createCell(parseFloat(r.diesel).toFixed(2) + ' Kc'));
    tr.appendChild(createCell(parseFloat(r.lpg).toFixed(2) + ' Kc'));
    tbody.appendChild(tr);
  });

  const labels = rows.map((r) => new Date(r.checked_at).toLocaleDateString('cs-CZ'));
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Natural 95', data: rows.map((r) => parseFloat(r.natural95)), borderColor: '#e8501a', tension: 0.3, fill: false },
        { label: 'Diesel',     data: rows.map((r) => parseFloat(r.diesel)),    borderColor: '#2563eb', tension: 0.3, fill: false },
        { label: 'LPG',        data: rows.map((r) => parseFloat(r.lpg)),       borderColor: '#16a34a', tension: 0.3, fill: false },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: false } },
    },
  });
}

document.getElementById('subscribe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('sub-email').value.trim();
  const msg = document.getElementById('sub-message');
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    msg.textContent = res.ok
      ? 'Prihlaseni uspesne! Budete dostavat upozorneni na zmeny cen.'
      : 'Chyba: ' + data.error;
  } catch {
    msg.textContent = 'Nastala chyba. Zkuste to znovu.';
  }
});

loadLatest();
loadHistory();
