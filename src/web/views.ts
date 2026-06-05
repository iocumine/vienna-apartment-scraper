import { escapeHtml, eur } from '../alerts/format.js';
import type { Summary, Trends, MapPoint } from './data.js';

function layout(title: string, nav: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; }
    header { background: #1f2937; color: #fff; padding: 12px 20px; }
    header a { color: #cbd5e1; margin-right: 16px; text-decoration: none; }
    header a:hover { color: #fff; }
    main { padding: 20px; max-width: 1100px; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 14px; }
    th { background: #f3f4f6; }
    .cards { display: flex; gap: 16px; flex-wrap: wrap; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; min-width: 140px; }
    .card .n { font-size: 28px; font-weight: 700; }
    #map { height: 600px; border-radius: 8px; }
  </style>
</head>
<body>
  <header>
    <strong>Vienna Apartments</strong>
    ${nav}
  </header>
  <main>${body}</main>
</body>
</html>`;
}

const NAV = `
  <a href="/">Overview</a>
  <a href="/trends">Price trends</a>
  <a href="/map">Map</a>`;

export function renderOverview(summary: Summary): string {
  const rows = summary.newListings
    .map(
      (l) => `<tr>
      <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title ?? 'Untitled')}</a></td>
      <td>${l.district ?? '?'}</td>
      <td>${l.rooms ?? '?'}</td>
      <td>${l.area_m2 ?? '?'}</td>
      <td>${escapeHtml(eur(l.price))}</td>
      <td>${escapeHtml(eur(l.price_per_m2))}</td>
    </tr>`,
    )
    .join('');
  const districtRows = summary.districts
    .map(
      (d) => `<tr><td>${d.district}</td><td>${escapeHtml(eur(d.median_price_per_m2))}</td>
      <td>${escapeHtml(eur(d.avg_price_per_m2))}</td><td>${d.active_count}</td></tr>`,
    )
    .join('');
  const body = `
    <h1>Overview</h1>
    <div class="cards">
      <div class="card"><div class="n">${summary.activeCount}</div>active listings</div>
      <div class="card"><div class="n">${summary.newCount}</div>new in last 24h</div>
      <div class="card"><div class="n">${summary.districts.length}</div>districts tracked</div>
    </div>
    <h2>Current sqm price by district</h2>
    <table><thead><tr><th>District</th><th>Median EUR/m&sup2;</th><th>Avg EUR/m&sup2;</th><th>Active</th></tr></thead>
    <tbody>${districtRows || '<tr><td colspan="4">No data yet</td></tr>'}</tbody></table>
    <h2>New listings (last 24h)</h2>
    <table><thead><tr><th>Title</th><th>District</th><th>Rooms</th><th>m&sup2;</th><th>Price</th><th>EUR/m&sup2;</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">Nothing new</td></tr>'}</tbody></table>`;
  return layout('Vienna Apartments - Overview', NAV, body);
}

export function renderTrends(trends: Trends): string {
  const body = `
    <h1>Square-meter price per district over time</h1>
    <canvas id="chart" height="120"></canvas>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
    <script>
      const trends = ${JSON.stringify(trends)};
      const palette = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#6366f1','#84cc16'];
      const datasets = trends.series.map((s, i) => ({
        label: 'District ' + s.district,
        data: s.points.map(p => ({ x: p.date, y: p.median })),
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length],
        spanGaps: true,
        tension: 0.2,
      }));
      new Chart(document.getElementById('chart'), {
        type: 'line',
        data: { datasets },
        options: {
          parsing: false,
          scales: {
            x: { type: 'category', labels: trends.dates },
            y: { title: { display: true, text: 'Median EUR/m2' } },
          },
        },
      });
    </script>
    ${trends.dates.length === 0 ? '<p>No daily stats recorded yet. They are snapshotted once per day.</p>' : ''}`;
  return layout('Vienna Apartments - Trends', NAV, body);
}

export function renderMap(points: MapPoint[]): string {
  const body = `
    <h1>Listings map</h1>
    <p>Green = below district median sqm price, red = at/above.</p>
    <div id="map"></div>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const points = ${JSON.stringify(points)};
      const map = L.map('map').setView([48.2082, 16.3738], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      for (const p of points) {
        if (p.lat == null || p.lng == null) continue;
        const color = p.belowMedian ? '#16a34a' : '#dc2626';
        L.circleMarker([p.lat, p.lng], { radius: 7, color, fillColor: color, fillOpacity: 0.7 })
          .addTo(map)
          .bindPopup(
            '<strong>' + (p.title || 'Untitled') + '</strong><br/>' +
            'District ' + p.district + ' &middot; ' + (p.area_m2 || '?') + ' m2<br/>' +
            'EUR ' + (p.price || '?') + ' (' + (p.price_per_m2 || '?') + '/m2)<br/>' +
            '<a href="' + p.url + '" target="_blank" rel="noopener">View</a>'
          );
      }
    </script>`;
  return layout('Vienna Apartments - Map', NAV, body);
}
