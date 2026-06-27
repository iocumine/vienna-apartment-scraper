import { escapeHtml, eur } from '../alerts/format.js';
import type { Summary, Trends, MapPoint, ListingsRow } from './data.js';

function layout(title: string, nav: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; }
    header { background: #1f2937; color: #fff; padding: 12px 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    header a { color: #cbd5e1; text-decoration: none; }
    header a:hover { color: #fff; }
    main { padding: 20px; max-width: 1100px; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 14px; }
    th { background: #f3f4f6; }
    table.sortable thead tr:first-child th { cursor: pointer; user-select: none; white-space: nowrap; }
    table.sortable thead tr:first-child th:hover { background: #e5e7eb; }
    table.sortable th .arrow { color: #2563eb; font-size: 12px; }
    tr.row-link { cursor: pointer; }
    tr.row-link:hover td { background: #eef2ff; }
    tr.filters th { background: #fff; font-weight: 400; cursor: auto; vertical-align: top; }
    tr.filters input, tr.filters select { width: 100%; box-sizing: border-box; font-size: 13px; padding: 5px; border: 1px solid #d1d5db; border-radius: 6px; }
    .cmp { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    tr.filters .cmp select { flex: 0 0 48px; width: 48px; padding: 5px 2px; }
    tr.filters .cmp input { flex: 1 1 64px; width: auto; min-width: 64px; }
    a.card-link { text-decoration: none; color: inherit; cursor: pointer; }
    a.card-link:hover { background: #eef2ff; border-color: #c7d2fe; }
    .cards { display: flex; gap: 16px; flex-wrap: wrap; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; min-width: 140px; }
    .card .n { font-size: 28px; font-weight: 700; }
    #map { height: 600px; border-radius: 8px; }
    .tile { position: relative; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 0 0 16px; }
    .tile h2 { margin: 0 68px 12px 0; font-size: 16px; }
    .tile .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
    .series-toggle { display: flex; align-items: center; gap: 6px; font-size: 14px; }
    .series-toggle select { font-size: 14px; padding: 6px 8px; border-radius: 6px; border: 1px solid #d1d5db; }
    .chart-wrap { position: relative; width: 100%; height: 320px; }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .controls select, .controls button { font-size: 16px; padding: 8px 10px; border-radius: 6px; border: 1px solid #d1d5db; }
    .controls button { background: #2563eb; color: #fff; border-color: #2563eb; cursor: pointer; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .tile .tile-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; z-index: 1; }
    .tile .tile-actions button { width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; background: #f3f4f6; border: 1px solid #e5e7eb; color: #374151; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1; }
    .tile .tile-actions button[hidden] { display: none !important; }
    .tile .tile-actions button:hover { background: #e5e7eb; }
    .tile .tile-actions .close:hover { background: #ef4444; border-color: #ef4444; color: #fff; }
    body.tile-maximized { overflow: hidden; }
    body.tile-maximized header { position: relative; z-index: 1001; }
    body.tile-maximized main > h1,
    body.tile-maximized main > section.tile:not(.district-tile.maximized),
    body.tile-maximized main > p { display: none; }
    body.tile-maximized #tiles .district-tile:not(.maximized) { display: none; }
    body.tile-maximized #tiles { display: block; }
    .tile.district-tile.maximized { position: fixed; top: 49px; left: 0; right: 0; bottom: 0; z-index: 1000; max-width: none; margin: 0; border-radius: 0; padding: 20px; }
    .tile.district-tile.maximized .chart-wrap { height: calc(100vh - 100px); }
    @media (max-width: 640px) {
      main { padding: 12px; }
      .chart-wrap { height: 260px; }
      .tiles { grid-template-columns: 1fr; }
      .controls select, .controls button { flex: 1 1 auto; }
    }
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

interface ListingLikeRow {
  url?: string | null;
  title?: string | null;
  district?: number | null;
  rooms?: number | null;
  area_m2?: number | null;
  price?: number | null;
  price_per_m2?: number | null;
}

// Sortable column headers shared by the overview and listings tables. Each cell
// declares its sort type and carries a span where the sort arrow is rendered.
const LISTING_HEADERS = `<tr>
      <th data-type="text">Title<span class="arrow"></span></th>
      <th data-type="num">District<span class="arrow"></span></th>
      <th data-type="num">Rooms<span class="arrow"></span></th>
      <th data-type="num">m&sup2;<span class="arrow"></span></th>
      <th data-type="num">Price<span class="arrow"></span></th>
      <th data-type="num">EUR/m&sup2;<span class="arrow"></span></th>
    </tr>`;

function listingRowHtml(l: ListingLikeRow): string {
  return `<tr>
      <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title ?? 'Untitled')}</a></td>
      <td data-sort-value="${l.district ?? ''}">${l.district ?? '?'}</td>
      <td data-sort-value="${l.rooms ?? ''}">${l.rooms ?? '?'}</td>
      <td data-sort-value="${l.area_m2 ?? ''}">${l.area_m2 ?? '?'}</td>
      <td data-sort-value="${l.price ?? ''}">${escapeHtml(eur(l.price))}</td>
      <td data-sort-value="${l.price_per_m2 ?? ''}">${escapeHtml(eur(l.price_per_m2))}</td>
    </tr>`;
}

// Client script that makes every table.sortable clickable-to-sort (asc/desc per
// column, empty values last). Shared by the overview and listings pages.
function sortableScript(): string {
  return `<script>
      (function () {
        function cellValue(td, type) {
          if (!td) return null;
          const raw = td.getAttribute('data-sort-value');
          const s = (raw !== null ? raw : td.textContent).trim();
          if (s === '') return null;
          if (type === 'num') { const n = Number(s); return Number.isFinite(n) ? n : null; }
          return s.toLowerCase();
        }
        document.querySelectorAll('table.sortable').forEach(function (table) {
          if (!table.tHead) return;
          const ths = table.tHead.rows[0].cells;
          let sortCol = -1, sortDir = 1; // 1 asc, -1 desc
          function updateArrows() {
            for (let i = 0; i < ths.length; i++) {
              const a = ths[i].querySelector('.arrow');
              if (a) a.textContent = (i === sortCol) ? (sortDir === 1 ? ' \u25b2' : ' \u25bc') : '';
            }
          }
          function sortBy(col) {
            const type = ths[col].getAttribute('data-type') || 'text';
            sortDir = (sortCol === col) ? -sortDir : 1;
            sortCol = col;
            const tbody = table.tBodies[0];
            const rows = Array.prototype.slice.call(tbody.rows).filter(function (r) { return r.cells.length === ths.length; });
            if (rows.length === 0) { updateArrows(); return; }
            rows.sort(function (a, b) {
              const av = cellValue(a.cells[col], type), bv = cellValue(b.cells[col], type);
              if (av === null && bv === null) return 0;
              if (av === null) return 1;
              if (bv === null) return -1;
              if (av < bv) return -sortDir;
              if (av > bv) return sortDir;
              return 0;
            });
            rows.forEach(function (r) { tbody.appendChild(r); });
            updateArrows();
          }
          for (let c = 0; c < ths.length; c++) {
            (function (col) { ths[col].addEventListener('click', function () { sortBy(col); }); })(c);
          }
        });
      })();
    </script>`;
}

export function renderOverview(summary: Summary): string {
  const districtRows = summary.districts
    .map(
      (d) => `<tr class="row-link" data-href="/listings?district=${d.district}" tabindex="0" role="link" aria-label="View active listings in district ${d.district}">
      <td data-sort-value="${d.district}">${d.district}</td>
      <td data-sort-value="${d.median_price_per_m2 ?? ''}">${escapeHtml(eur(d.median_price_per_m2))}</td>
      <td data-sort-value="${d.avg_price_per_m2 ?? ''}">${escapeHtml(eur(d.avg_price_per_m2))}</td>
      <td data-sort-value="${d.active_count}">${d.active_count}</td></tr>`,
    )
    .join('');
  const body = `
    <h1>Overview</h1>
    <div class="cards">
      <a class="card card-link" href="/listings" title="View all active listings"><div class="n">${summary.activeCount}</div>active listings</a>
      <a class="card card-link" href="/new-listings" title="View new listings (last 24h)"><div class="n">${summary.newCount}</div>new in last 24h</a>
      <div class="card"><div class="n">${summary.districts.length}</div>districts tracked</div>
    </div>
    <h2>Median sqm price by district (monitored period)</h2>
    <table id="district-stats" class="sortable">
      <thead><tr>
        <th data-type="num">District<span class="arrow"></span></th>
        <th data-type="num">Median EUR/m&sup2;<span class="arrow"></span></th>
        <th data-type="num">Avg EUR/m&sup2;<span class="arrow"></span></th>
        <th data-type="num">Active<span class="arrow"></span></th>
      </tr></thead>
    <tbody>${districtRows || '<tr><td colspan="4">No data yet</td></tr>'}</tbody></table>
    ${sortableScript()}
    <script>
      (function () {
        document.querySelectorAll('#district-stats tbody tr.row-link').forEach(function (row) {
          function go() {
            const href = row.getAttribute('data-href');
            if (href) window.location.href = href;
          }
          row.addEventListener('click', go);
          row.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
          });
        });
      })();
    </script>`;
  return layout('Vienna Apartments - Overview', NAV, body);
}

interface ListingsPageOptions {
  docTitle: string;
  heading: string;
  emptyText: string;
  listings: ListingsRow[];
}

// Shared filterable + sortable listings page. Used for both the full active set
// and the last-24h new listings so the table/filter logic lives in one place.
function listingsPage({ docTitle, heading, emptyText, listings }: ListingsPageOptions): string {
  const districts = [...new Set(listings.map((l) => l.district).filter((d): d is number => d != null))].sort(
    (a, b) => a - b,
  );
  const roomCounts = [...new Set(listings.map((l) => l.rooms).filter((r): r is number => r != null))].sort(
    (a, b) => a - b,
  );
  const districtOptions = districts.map((d) => `<option value="${d}">${d}</option>`).join('');
  const roomOptions = roomCounts.map((r) => `<option value="${r}">${r}</option>`).join('');
  const cmp = (idPrefix: string, placeholder: string): string =>
    `<span class="cmp">
        <select id="${idPrefix}-op"><option value="gt">&gt;</option><option value="lt">&lt;</option></select>
        <input type="number" id="${idPrefix}-val" placeholder="${placeholder}" />
      </span>`;
  const rows = listings.map(listingRowHtml).join('');
  const body = `
    <h1>${escapeHtml(heading)}</h1>
    <p id="count"></p>
    <table id="listings-table" class="sortable">
      <thead>
    ${LISTING_HEADERS}
        <tr class="filters">
          <th><input type="text" id="f-title" placeholder="contains&hellip;" aria-label="Filter by title" /></th>
          <th><select id="f-district" aria-label="Filter by district"><option value="">All</option>${districtOptions}</select></th>
          <th><select id="f-rooms" aria-label="Filter by rooms"><option value="">All</option>${roomOptions}</select></th>
          <th>${cmp('f-area', 'm²')}</th>
          <th>${cmp('f-price', 'EUR')}</th>
          <th>${cmp('f-ppm2', 'EUR/m²')}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="6">${escapeHtml(emptyText)}</td></tr>`}</tbody>
    </table>
    ${sortableScript()}
    <script>
      (function () {
        const table = document.getElementById('listings-table');
        const tbody = table.tBodies[0];
        const countEl = document.getElementById('count');
        const COLS = 6;
        const f = {};
        ['f-title','f-district','f-rooms','f-area-op','f-area-val','f-price-op','f-price-val','f-ppm2-op','f-ppm2-val']
          .forEach(function (id) { f[id] = document.getElementById(id); });

        function numAt(row, col) {
          const v = row.cells[col].getAttribute('data-sort-value');
          if (v === null || v.trim() === '') return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        }
        function cmpOk(value, op, threshold) {
          if (threshold === '' || threshold == null) return true; // filter inactive
          const t = Number(threshold);
          if (!Number.isFinite(t)) return true;
          if (value === null) return false; // missing data can't satisfy a numeric filter
          return op === 'lt' ? value < t : value > t;
        }
        function matches(row) {
          if (row.cells.length !== COLS) return false;
          const title = f['f-title'].value.trim().toLowerCase();
          if (title && row.cells[0].textContent.toLowerCase().indexOf(title) === -1) return false;
          if (f['f-district'].value && row.cells[1].getAttribute('data-sort-value') !== f['f-district'].value) return false;
          if (f['f-rooms'].value && row.cells[2].getAttribute('data-sort-value') !== f['f-rooms'].value) return false;
          if (!cmpOk(numAt(row, 3), f['f-area-op'].value, f['f-area-val'].value)) return false;
          if (!cmpOk(numAt(row, 4), f['f-price-op'].value, f['f-price-val'].value)) return false;
          if (!cmpOk(numAt(row, 5), f['f-ppm2-op'].value, f['f-ppm2-val'].value)) return false;
          return true;
        }
        function apply() {
          let shown = 0, total = 0;
          Array.prototype.slice.call(tbody.rows).forEach(function (row) {
            if (row.cells.length !== COLS) return; // placeholder row
            total++;
            const ok = matches(row);
            row.style.display = ok ? '' : 'none';
            if (ok) shown++;
          });
          countEl.textContent = 'Showing ' + shown + ' of ' + total + ' listings';
        }
        Object.keys(f).forEach(function (id) {
          if (!f[id]) return;
          f[id].addEventListener('input', apply);
          f[id].addEventListener('change', apply);
        });
        (function initFromQuery() {
          const district = new URLSearchParams(window.location.search).get('district');
          if (!district) return;
          const n = Number(district);
          if (!Number.isFinite(n)) return;
          const sel = f['f-district'];
          const match = Array.prototype.find.call(sel.options, function (o) { return o.value === String(n); });
          if (match) sel.value = String(n);
        })();
        apply();
      })();
    </script>`;
  return layout(docTitle, NAV, body);
}

export function renderListings(listings: ListingsRow[]): string {
  return listingsPage({
    docTitle: 'Vienna Apartments - Active listings',
    heading: 'Active listings',
    emptyText: 'No active listings',
    listings,
  });
}

export function renderNewListings(listings: ListingsRow[]): string {
  return listingsPage({
    docTitle: 'Vienna Apartments - New listings',
    heading: 'New listings (last 24h)',
    emptyText: 'No new listings in the last 24h',
    listings,
  });
}

export function renderTrends(trends: Trends): string {
  const districtOptions = trends.series
    .map((s) => `<option value="${s.district}">District ${s.district}</option>`)
    .join('');
  const body = `
    <h1>Square-meter price trends</h1>

    <section class="tile">
      <div class="head">
        <h2>All districts &mdash; EUR/m&sup2;</h2>
        <div class="series-toggle">
          <label for="main-series">Series:</label>
          <select id="main-series" aria-label="Main chart series">
            <option value="median">Raw data points</option>
            <option value="ma5">5-day moving average</option>
            <option value="ma20">20-day moving average</option>
          </select>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="main-chart"></canvas></div>
    </section>

    <section class="tile controls">
      <label for="district-select">Add a district tile:</label>
      <select id="district-select" aria-label="District to add">${districtOptions}</select>
      <button id="add-tile" type="button">Add tile</button>
    </section>

    <div id="tiles" class="tiles"></div>
    ${trends.dates.length === 0 ? '<p>No daily stats recorded yet. They are snapshotted once per day.</p>' : ''}

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
    <script>
      const trends = ${JSON.stringify(trends)};
      const palette = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#6366f1','#84cc16'];
      const labels = trends.dates;
      const seriesByDistrict = {};
      trends.series.forEach(function (s) { seriesByDistrict[s.district] = s; });

      const BASE_WIDTH = 2, EMPHASIZED_WIDTH = 4, DIMMED_WIDTH = 1;

      // Bold the hovered legend label text by repainting it after Chart.js draws the legend.
      function drawBoldLegendLabel(chart) {
        const hovered = chart._hoveredDatasetIndex;
        if (hovered == null || hovered < 0) return;
        const legend = chart.legend;
        if (!legend || !legend.options.display || !legend.legendItems || !legend.legendHitBoxes) return;

        const itemIndex = legend.legendItems.findIndex(function (it) { return it.datasetIndex === hovered; });
        if (itemIndex < 0) return;
        const item = legend.legendItems[itemIndex];
        const hitbox = legend.legendHitBoxes[itemIndex];
        if (!item || !hitbox || !item.text) return;

        const helpers = Chart.helpers;
        const labelOpts = legend.options.labels;
        const labelFont = helpers.toFont(labelOpts.font);
        const boldFont = helpers.toFont({
          size: labelFont.size,
          family: labelFont.family,
          style: labelFont.style,
          lineHeight: labelFont.lineHeight,
          weight: 'bold',
        });
        const boxWidth = labelOpts.boxWidth || 40;
        const itemHeight = hitbox.height;
        const halfFontSize = labelFont.size / 2;
        const rtlHelper = helpers.getRtlAdapter(legend.options.rtl, legend.left, legend.width);
        const textAlign = item.textAlign || labelOpts.textAlign || 'left';
        let textX = hitbox.left + boxWidth + halfFontSize;
        textX = helpers._textX(textAlign, textX, hitbox.left + hitbox.width, legend.options.rtl);
        textX = rtlHelper.x(textX);
        const textY = hitbox.top + itemHeight / 2;
        const colorOpt = labelOpts.color;
        const textColor = typeof colorOpt === 'function'
          ? colorOpt({ chart: chart, type: 'legend' })
          : (colorOpt || chart.options.color || '#666');

        const ctx = chart.ctx;
        ctx.save();
        ctx.font = boldFont.string;
        const textWidth = ctx.measureText(String(item.text)).width;
        const padX = 4;
        const padY = 3;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(textX - padX, textY - labelFont.size / 2 - padY, textWidth + padX * 2, labelFont.size + padY * 2);
        helpers.renderText(ctx, item.text, textX, textY, boldFont, {
          color: textColor,
          textAlign: rtlHelper.textAlign(textAlign),
        });
        ctx.restore();
      }

      function datasetIndexAtEvent(chart, evt) {
        const els = chart.getElementsAtEventForMode(evt.native || evt, 'nearest', { intersect: false }, true);
        return els.length ? els[0].datasetIndex : -1;
      }

      function setEmphasizedDataset(chart, hovered) {
        if (hovered == null || !Number.isFinite(hovered)) hovered = -1;
        let changed = false;
        if (chart._hoveredDatasetIndex !== hovered) {
          chart._hoveredDatasetIndex = hovered;
          changed = true;
        }
        chart.data.datasets.forEach(function (ds, i) {
          const target = hovered === -1 ? BASE_WIDTH : (i === hovered ? EMPHASIZED_WIDTH : DIMMED_WIDTH);
          if (ds.borderWidth !== target) { ds.borderWidth = target; changed = true; }
        });
        if (changed) chart.update('none');
      }

      // Thicken the hovered line, thin the rest, and bold the matching legend label.
      function emphasizeHovered(chart, evt) {
        setEmphasizedDataset(chart, datasetIndexAtEvent(chart, evt));
      }

      function baseOptions(yTitle, legendOverrides) {
        const legend = {
          onHover: function (_evt, legendItem, legend) {
            if (legendItem && legendItem.datasetIndex != null) {
              setEmphasizedDataset(legend.chart, legendItem.datasetIndex);
            }
          },
          onLeave: function (_evt, _legendItem, legend) {
            setEmphasizedDataset(legend.chart, -1);
          },
        };
        if (legendOverrides) {
          Object.keys(legendOverrides).forEach(function (k) { legend[k] = legendOverrides[k]; });
        }
        return {
          responsive: true,
          maintainAspectRatio: false,
          parsing: false,
          interaction: { mode: 'index', intersect: false },
          onHover: function (evt, _active, chart) { emphasizeHovered(chart, evt); },
          plugins: {
            legend: legend,
            legendBold: {
              afterDraw: function (chart) { drawBoldLegendLabel(chart); },
            },
          },
          scales: {
            x: { type: 'category', labels: labels },
            y: { title: { display: true, text: yTitle } }
          }
        };
      }

      function points(s, key) {
        return s.points.map(function (p) { return { x: p.date, y: p[key] }; });
      }

      // Main tile: one line per district. The series (raw median / 5-day MA /
      // 20-day MA) is switchable for all districts at once.
      function buildMainDatasets(key) {
        return trends.series.map(function (s, i) {
          return {
            label: 'District ' + s.district,
            data: points(s, key),
            borderColor: palette[i % palette.length],
            backgroundColor: palette[i % palette.length],
            borderWidth: BASE_WIDTH,
            spanGaps: true,
            tension: 0.2
          };
        });
      }
      const MAIN_SERIES_KEY = 'vienna.trends.mainSeries';
      const MAIN_HIDDEN_KEY = 'vienna.trends.mainHidden';
      const mainSelect = document.getElementById('main-series');
      const allowedSeries = ['median', 'ma5', 'ma20'];
      let savedSeries = 'median';
      try {
        const stored = localStorage.getItem(MAIN_SERIES_KEY);
        if (allowedSeries.indexOf(stored) !== -1) savedSeries = stored;
      } catch (e) { /* storage unavailable; use default */ }
      mainSelect.value = savedSeries;

      function loadHiddenMainDistricts() {
        try {
          const arr = JSON.parse(localStorage.getItem(MAIN_HIDDEN_KEY) || '[]');
          return Array.isArray(arr) ? arr.map(Number).filter(function (n) { return Number.isFinite(n); }) : [];
        } catch (e) { return []; }
      }
      function saveHiddenMainDistricts(hidden) {
        try { localStorage.setItem(MAIN_HIDDEN_KEY, JSON.stringify(hidden)); }
        catch (e) { /* storage unavailable; ignore */ }
      }
      function applyMainVisibility(chart, hiddenDistricts) {
        chart.data.datasets.forEach(function (_ds, i) {
          const district = trends.series[i] ? trends.series[i].district : null;
          const hide = district != null && hiddenDistricts.indexOf(district) !== -1;
          chart.setDatasetVisibility(i, !hide);
        });
      }
      function syncHiddenMainDistricts(chart) {
        mainHiddenDistricts.length = 0;
        chart.data.datasets.forEach(function (_ds, i) {
          if (!chart.isDatasetVisible(i)) {
            const district = trends.series[i] ? trends.series[i].district : null;
            if (district != null) mainHiddenDistricts.push(district);
          }
        });
        saveHiddenMainDistricts(mainHiddenDistricts);
      }

      let mainHiddenDistricts = loadHiddenMainDistricts();
      const mainChart = new Chart(document.getElementById('main-chart'), {
        type: 'line',
        data: { datasets: buildMainDatasets(savedSeries) },
        options: baseOptions('EUR/m2', {
          onClick: function (_evt, legendItem, legend) {
            const index = legendItem.datasetIndex;
            const ci = legend.chart;
            if (ci.isDatasetVisible(index)) {
              ci.hide(index);
              legendItem.hidden = true;
            } else {
              ci.show(index);
              legendItem.hidden = false;
            }
            syncHiddenMainDistricts(ci);
          },
        }),
      });
      applyMainVisibility(mainChart, mainHiddenDistricts);
      mainChart.update();

      mainSelect.addEventListener('change', function (e) {
        mainChart._hoveredDatasetIndex = -1;
        mainChart.data.datasets = buildMainDatasets(e.target.value);
        applyMainVisibility(mainChart, mainHiddenDistricts);
        mainChart.update();
        try { localStorage.setItem(MAIN_SERIES_KEY, e.target.value); }
        catch (err) { /* storage unavailable; ignore */ }
      });

      // Per-district tiles: raw + 5-day and 20-day moving averages.
      const tilesEl = document.getElementById('tiles');
      const charts = {};
      const STORAGE_KEY = 'vienna.trends.tiles';
      const TILE_HIDDEN_KEY = 'vienna.trends.tileHidden';
      const TILE_SERIES = ['median', 'ma5', 'ma20'];

      function loadTileHiddenMap() {
        try {
          const obj = JSON.parse(localStorage.getItem(TILE_HIDDEN_KEY) || '{}');
          return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
        } catch (e) { return {}; }
      }
      function saveTileHiddenMap(map) {
        try { localStorage.setItem(TILE_HIDDEN_KEY, JSON.stringify(map)); }
        catch (e) { /* storage unavailable; ignore */ }
      }
      function hiddenTileSeries(district) {
        const arr = tileHiddenMap[district] || tileHiddenMap[String(district)] || [];
        return Array.isArray(arr)
          ? arr.filter(function (k) { return TILE_SERIES.indexOf(k) !== -1; })
          : [];
      }
      function applyTileVisibility(chart, district) {
        const hidden = hiddenTileSeries(district);
        TILE_SERIES.forEach(function (key, i) {
          chart.setDatasetVisibility(i, hidden.indexOf(key) === -1);
        });
      }
      function syncTileHiddenSeries(chart, district) {
        const hidden = [];
        TILE_SERIES.forEach(function (key, i) {
          if (!chart.isDatasetVisible(i)) hidden.push(key);
        });
        if (hidden.length === 0) {
          delete tileHiddenMap[district];
          delete tileHiddenMap[String(district)];
        } else {
          tileHiddenMap[district] = hidden;
        }
        saveTileHiddenMap(tileHiddenMap);
      }

      let tileHiddenMap = loadTileHiddenMap();

      function loadSavedDistricts() {
        try {
          const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
          return Array.isArray(arr)
            ? arr.map(Number).filter(function (n) { return Number.isFinite(n); }).sort(function (a, b) { return a - b; })
            : [];
        } catch (e) { return []; }
      }
      function saveDistricts() {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(Object.keys(charts).map(Number).sort(function (a, b) { return a - b; })),
          );
        } catch (e) { /* storage unavailable; ignore */ }
      }

      function insertTileSorted(tile, district) {
        const existing = tilesEl.querySelectorAll('.district-tile');
        for (let i = 0; i < existing.length; i++) {
          const d = Number(existing[i].dataset.district);
          if (district < d) {
            tilesEl.insertBefore(tile, existing[i]);
            return;
          }
        }
        tilesEl.appendChild(tile);
      }

      function resizeChart(district) {
        if (charts[district]) charts[district].resize();
      }

      function restoreTile(tile) {
        tile.classList.remove('maximized');
        document.body.classList.remove('tile-maximized');
        const maxBtn = tile.querySelector('.maximize');
        const restBtn = tile.querySelector('.restore');
        if (maxBtn) maxBtn.hidden = false;
        if (restBtn) restBtn.hidden = true;
        resizeChart(Number(tile.dataset.district));
      }

      function maximizeTile(tile) {
        const current = document.querySelector('.tile.district-tile.maximized');
        if (current && current !== tile) restoreTile(current);
        tile.classList.add('maximized');
        document.body.classList.add('tile-maximized');
        const maxBtn = tile.querySelector('.maximize');
        const restBtn = tile.querySelector('.restore');
        if (maxBtn) maxBtn.hidden = true;
        if (restBtn) restBtn.hidden = false;
        resizeChart(Number(tile.dataset.district));
      }

      function addTile(district) {
        const s = seriesByDistrict[district];
        if (!s || charts[district]) return; // unknown or already shown
        const tile = document.createElement('section');
        tile.className = 'tile district-tile';
        tile.dataset.district = String(district);

        const head = document.createElement('div');
        head.className = 'head';
        const h2 = document.createElement('h2');
        h2.textContent = 'District ' + district + ' \u2014 median & moving averages';
        head.appendChild(h2);

        const actions = document.createElement('div');
        actions.className = 'tile-actions';

        const maximize = document.createElement('button');
        maximize.className = 'maximize';
        maximize.type = 'button';
        maximize.setAttribute('aria-label', 'Maximize District ' + district + ' tile');
        maximize.textContent = '\u26f6';
        maximize.addEventListener('click', function (e) {
          e.stopPropagation();
          maximizeTile(tile);
        });

        const restore = document.createElement('button');
        restore.className = 'restore';
        restore.type = 'button';
        restore.hidden = true;
        restore.setAttribute('aria-label', 'Restore District ' + district + ' tile');
        restore.textContent = '\u2190';
        restore.addEventListener('click', function (e) {
          e.stopPropagation();
          restoreTile(tile);
        });

        const close = document.createElement('button');
        close.className = 'close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Remove District ' + district + ' tile');
        close.textContent = '\u00d7';
        close.addEventListener('click', function () {
          if (tile.classList.contains('maximized')) document.body.classList.remove('tile-maximized');
          if (charts[district]) { charts[district].destroy(); delete charts[district]; }
          tile.remove();
          saveDistricts();
        });

        actions.appendChild(maximize);
        actions.appendChild(restore);
        actions.appendChild(close);

        const wrap = document.createElement('div');
        wrap.className = 'chart-wrap';
        const canvas = document.createElement('canvas');
        wrap.appendChild(canvas);

        tile.appendChild(actions);
        tile.appendChild(head);
        tile.appendChild(wrap);
        insertTileSorted(tile, district);

        charts[district] = new Chart(canvas, {
          type: 'line',
          data: {
            datasets: [
              { label: 'Raw (median)', data: points(s, 'median'), borderColor: '#3b82f6', backgroundColor: '#3b82f6', borderWidth: BASE_WIDTH, spanGaps: true, tension: 0.2 },
              { label: 'MA 5d', data: points(s, 'ma5'), borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderWidth: BASE_WIDTH, spanGaps: true, borderDash: [6, 3], tension: 0.2 },
              { label: 'MA 20d', data: points(s, 'ma20'), borderColor: '#10b981', backgroundColor: '#10b981', borderWidth: BASE_WIDTH, spanGaps: true, borderDash: [2, 2], tension: 0.2 }
            ]
          },
          options: baseOptions('EUR/m2', {
            onClick: function (_evt, legendItem, legend) {
              const index = legendItem.datasetIndex;
              const ci = legend.chart;
              if (ci.isDatasetVisible(index)) {
                ci.hide(index);
                legendItem.hidden = true;
              } else {
                ci.show(index);
                legendItem.hidden = false;
              }
              syncTileHiddenSeries(ci, district);
            },
          }),
        });
        applyTileVisibility(charts[district], district);
        charts[district].update();
        saveDistricts();
      }

      document.getElementById('add-tile').addEventListener('click', function () {
        const sel = document.getElementById('district-select');
        if (sel && sel.value) addTile(Number(sel.value));
      });

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const tile = document.querySelector('.tile.district-tile.maximized');
        if (!tile) return;
        e.preventDefault();
        restoreTile(tile);
      });

      // Restore previously configured tiles.
      loadSavedDistricts().forEach(addTile);
    </script>`;
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
