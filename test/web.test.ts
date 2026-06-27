import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createRepository, type Repository } from '../src/db/index.js';
import { buildSummary, buildTrends, buildMapData, buildActiveListings, buildNewListings, buildPendingVerificationListings, buildVerifiedRemovedListings } from '../src/web/data.js';
import { renderOverview, renderTrends, renderMap, renderListings, renderNewListings, renderPendingVerificationListings, renderVerifiedRemovedListings, renderWillhabenRequests } from '../src/web/views.js';
import { parseDistrictQuery } from '../src/web/server.js';
import { resetWillhabenAccessStatus, recordWillhabenForbidden, recordVerificationDeferred } from '../src/lib/willhabenStatus.js';
import { recordWillhabenRequest, resetWillhabenRequestTracking, getWillhabenRequestsLast60s } from '../src/lib/rateLimit.js';
import type { AppConfig, NormalizedListing } from '../src/types.js';

function repoAt(now: string): Repository {
  return createRepository(new Database(':memory:'), { clock: () => now });
}

function listing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: 'a1', title: 'Flat', url: 'https://willhaben.at/1', district: 7, postcode: 1070,
    rooms: 2, area_m2: 50, price: 1000, price_per_m2: null, lat: 48.2, lng: 16.3,
    published_at: null, ...over,
  };
}

const config = { willhabenRequestsPerMinute: 25 } as AppConfig;

describe('buildSummary', () => {
  beforeEach(() => {
    resetWillhabenAccessStatus();
    resetWillhabenRequestTracking();
  });

  it('counts active and last-24h listings plus period district stats', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'a2', district: 9, price: 1500, area_m2: 50 }));
    repo.upsertDailyStats({ date: '2026-06-01', district: 7, median_price_per_m2: 18, avg_price_per_m2: 18, active_count: 1 });
    repo.upsertDailyStats({ date: '2026-06-02', district: 7, median_price_per_m2: 22, avg_price_per_m2: 22, active_count: 1 });
    const summary = buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z');
    expect(summary.activeCount).toBe(2);
    expect(summary.newCount).toBe(2);
    expect(summary.districts.map((d) => d.district)).toEqual([7, 9]);
    expect(summary.districts[0]).toMatchObject({ district: 7, median_price_per_m2: 20, active_count: 1 });
    expect(summary.districts[1]).toMatchObject({ district: 9, median_price_per_m2: 30, active_count: 1 });
    expect(summary.uiAlerts.willhabenAccess.forbidden).toBe(false);
  });

  it('includes request rate and pending verification counts', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1' }));
    repo.upsertListing(listing({ id: 'pending' }));
    repo.db.prepare('UPDATE listings SET miss_count = 1 WHERE id = ?').run('pending');
    recordWillhabenRequest(new Date('2026-06-06T12:00:00.000Z').getTime() - 5_000);
    recordWillhabenRequest(new Date('2026-06-06T12:00:00.000Z').getTime() - 2_000);

    const summary = buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z');
    expect(summary.willhabenRequestsLast60s).toBe(2);
    expect(summary.willhabenStartupStats.total).toBe(2);
    expect(summary.willhabenRequestsPerMinute).toBe(25);
    expect(summary.pendingVerificationCount).toBe(1);
  });

  it('includes verified removed count', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'gone' }));
    repo.db.prepare(
      `UPDATE listings SET is_active = 0, miss_count = 10, verification_miss_threshold = 5 WHERE id = ?`,
    ).run('gone');
    repo.upsertListing(listing({ id: 'other-off' }));
    repo.deactivateListing('other-off');

    const summary = buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z');
    expect(summary.verifiedRemovedCount).toBe(1);
  });

  it('includes willhaben 403 status in the summary payload', () => {
    recordWillhabenForbidden('willhaben request failed: 403 Forbidden', '2026-06-06T12:00:00.000Z');
    const summary = buildSummary(repoAt('2026-06-06T12:00:00.000Z'), config);
    expect(summary.uiAlerts.willhabenAccess).toMatchObject({
      forbidden: true,
      lastForbiddenAt: '2026-06-06T12:00:00.000Z',
      lastMessage: 'willhaben request failed: 403 Forbidden',
    });
  });

  it('includes deferred verification status in the summary payload', () => {
    recordVerificationDeferred(4, 50, '2026-06-06T12:00:00.000Z');
    const summary = buildSummary(repoAt('2026-06-06T12:00:00.000Z'), config);
    expect(summary.uiAlerts.verificationRateLimit).toMatchObject({
      deferred: true,
      deferredCount: 4,
      requestsPerMinuteLimit: 50,
    });
  });
});

describe('buildTrends', () => {
  it('pivots history into per-district series sorted by date', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertDailyStats({ date: '2026-06-02', district: 7, median_price_per_m2: 22, avg_price_per_m2: 22, active_count: 3 });
    repo.upsertDailyStats({ date: '2026-06-01', district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 3 });
    repo.upsertDailyStats({ date: '2026-06-01', district: 9, median_price_per_m2: 30, avg_price_per_m2: 30, active_count: 2 });
    const trends = buildTrends(repo);
    expect(trends.dates).toEqual(['2026-06-01', '2026-06-02']);
    expect(trends.series.map((s) => s.district)).toEqual([7, 9]);
    expect(trends.series[0]!.points.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-02']);
    expect(trends.series[0]!.points[0]!.median).toBe(20);
  });

  it('attaches 5- and 20-day trailing moving averages of the median series', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    const medians = [10, 20, 30, 40, 50, 60];
    medians.forEach((m, i) => {
      const date = `2026-06-0${i + 1}`;
      repo.upsertDailyStats({ date, district: 7, median_price_per_m2: m, avg_price_per_m2: m, active_count: 3 });
    });
    const trends = buildTrends(repo);
    const pts = trends.series[0]!.points;
    // ma5 is a trailing average with partial windows at the start.
    expect(pts.map((p) => p.ma5)).toEqual([10, 15, 20, 25, 30, 40]);
    // With <20 points ma20 is just the running average from the start.
    expect(pts[5]!.ma20).toBe(35); // avg(10..60)
  });
});

describe('buildActiveListings', () => {
  it('returns only active listings, mapped and sorted by district then price', () => {
    const clock = { now: '2026-06-01T12:00:00.000Z' };
    const repo = createRepository(new Database(':memory:'), { clock: () => clock.now });
    repo.upsertListing(listing({ id: 'old', district: 7, price: 1000, area_m2: 50 }));
    // Deactivate the old one by advancing the clock past its last_seen_at.
    clock.now = '2026-06-02T12:00:00.000Z';
    repo.deactivateNotSeenSince('2026-06-02T00:00:00.000Z');
    repo.upsertListing(listing({ id: 'b9', district: 9, price: 2000, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'a7hi', district: 7, price: 1500, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'a7lo', district: 7, price: 900, area_m2: 50 }));
    // A listing with null district/rooms/price sorts last and maps to nulls.
    repo.upsertListing(listing({ id: 'nulls', district: null, rooms: null, area_m2: null, price: null, price_per_m2: null }));

    const active = buildActiveListings(repo);
    expect(active.map((l) => l.id)).toEqual(['a7lo', 'a7hi', 'b9', 'nulls']); // 'old' excluded, nulls last
    expect(active[0]).toMatchObject({ district: 7, price: 900, area_m2: 50 });
    expect(active[3]).toMatchObject({ id: 'nulls', district: null, rooms: null, price: null });

    const html = renderListings(active);
    expect(html).toContain('<option value="7">7</option>');
    expect(html).toContain('<option value="9">9</option>');
    expect(html).toContain('Showing');
  });

  it('marks listings with miss_count as pending verification on the active page', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'ok', district: 7 }));
    repo.upsertListing(listing({ id: 'pending', district: 7 }));
    repo.db.prepare('UPDATE listings SET miss_count = 2 WHERE id = ?').run('pending');

    const active = buildActiveListings(repo);
    expect(active.find((l) => l.id === 'pending')!.pendingVerification).toBe(true);
    expect(active.find((l) => l.id === 'ok')!.pendingVerification).toBe(false);

    const html = renderListings(active);
    expect(html).toContain('pending verification');
  });
});

describe('buildNewListings', () => {
  it('returns only listings first seen in the last 24h, mapped to the table shape', () => {
    const clock = { now: '2026-06-04T12:00:00.000Z' };
    const repo = createRepository(new Database(':memory:'), { clock: () => clock.now });
    repo.upsertListing(listing({ id: 'old', district: 7, price: 1000, area_m2: 50 }));
    clock.now = '2026-06-06T11:00:00.000Z';
    repo.upsertListing(listing({ id: 'fresh', district: 9, price: 1500, area_m2: 50 }));

    const news = buildNewListings(repo, () => '2026-06-06T12:00:00.000Z');
    expect(news.map((l) => l.id)).toEqual(['fresh']); // 'old' first seen >24h ago
    expect(news[0]).toMatchObject({ district: 9, price: 1500 });
  });
});

describe('buildPendingVerificationListings', () => {
  it('returns only active listings with miss_count > 0', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'ok', district: 7 }));
    repo.upsertListing(listing({ id: 'pending', district: 9 }));
    repo.db.prepare('UPDATE listings SET miss_count = 2 WHERE id = ?').run('pending');

    const rows = buildPendingVerificationListings(repo);
    expect(rows.map((l) => l.id)).toEqual(['pending']);
    expect(rows[0]!.pendingVerification).toBe(true);
  });
});

describe('buildVerifiedRemovedListings', () => {
  it('returns inactive listings that reached verification threshold before removal', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'verified-gone', district: 7 }));
    repo.db.prepare(
      `UPDATE listings SET is_active = 0, miss_count = 10, verification_miss_threshold = 5 WHERE id = ?`,
    ).run('verified-gone');
    repo.upsertListing(listing({ id: 'other-off', district: 9 }));
    repo.deactivateListing('other-off');

    const rows = buildVerifiedRemovedListings(repo);
    expect(rows.map((l) => l.id)).toEqual(['verified-gone']);
    expect(rows[0]!.pendingVerification).toBe(false);
  });
});

describe('buildMapData', () => {
  it('tags listings as below/above district median and skips ungeocoded', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'cheap', district: 7, price: 800, area_m2: 50, lat: 48.2, lng: 16.3 })); // 16
    repo.upsertListing(listing({ id: 'pricey', district: 7, price: 1200, area_m2: 50, lat: 48.3, lng: 16.4 })); // 24
    repo.upsertListing(listing({ id: 'nogeo', district: 7, price: 1000, area_m2: 50, lat: null, lng: null })); // 20
    const points = buildMapData(repo);
    expect(points).toHaveLength(2);
    const cheap = points.find((p) => p.id === 'cheap')!;
    const pricey = points.find((p) => p.id === 'pricey')!;
    expect(cheap.districtMedian).toBe(20); // median of [16,24]
    expect(cheap.belowMedian).toBe(true);
    expect(pricey.belowMedian).toBe(false);
  });
});

describe('parseDistrictQuery', () => {
  it('returns null when the param is missing or empty', () => {
    expect(parseDistrictQuery(undefined)).toBeNull();
    expect(parseDistrictQuery(null)).toBeNull();
    expect(parseDistrictQuery('')).toBeNull();
    expect(parseDistrictQuery('   ')).toBeNull();
  });

  it('parses numeric district values', () => {
    expect(parseDistrictQuery('7')).toBe(7);
    expect(parseDistrictQuery('0')).toBe(0);
  });

  it('returns null for non-numeric values', () => {
    expect(parseDistrictQuery('abc')).toBeNull();
  });
});

describe('renderWillhabenRequests', () => {
  beforeEach(() => resetWillhabenRequestTracking());

  it('lists recent requests with url, status, and result', () => {
    const now = Date.parse('2026-06-06T12:00:00.000Z');
    recordWillhabenRequest({
      at: now - 5_000,
      url: 'https://www.willhaben.at/a',
      status: 200,
      ok: true,
    });
    recordWillhabenRequest({
      at: now - 2_000,
      url: 'https://www.willhaben.at/b',
      status: 403,
      ok: false,
    });

    const html = renderWillhabenRequests(getWillhabenRequestsLast60s(now), 25);
    expect(html).toContain('Willhaben requests (last 60s)');
    expect(html).toContain('id="willhaben-requests"');
    expect(html).toContain('https://www.willhaben.at/a');
    expect(html).toContain('https://www.willhaben.at/b');
    expect(html).toContain('403');
    expect(html).toContain('Failed');
    expect(html).toContain('OK');
  });
});

describe('views render valid html', () => {
  beforeEach(() => resetWillhabenAccessStatus());

  it('renders overview, trends, and map', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50, lat: 48.2, lng: 16.3 }));
    repo.upsertDailyStats({ date: '2026-06-01', district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 1 });

    const overview = renderOverview(buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z'));
    expect(overview).toContain('<!doctype html>');
    expect(overview).toContain('Overview');
    // Overview no longer embeds the new-listings table; both tiles link out.
    expect(overview).not.toContain('id="listings-table"');
    expect(overview).toContain('href="/listings"');
    expect(overview).toContain('href="/new-listings"');
    expect(overview).toContain('href="/pending-verification"');
    expect(overview).toContain('href="/removed-listings"');
    expect(overview).toContain('removed after verification');
    expect(overview).toContain('pending verification');
    expect(overview).toContain('class="card-rows"');
    expect(overview).not.toContain('requests last 60s');
    expect(overview).not.toContain('max requests / min');
    // Row 1: listing tiles before districts.
    expect(overview.indexOf('active listings')).toBeLessThan(overview.indexOf('districts tracked'));
    expect(overview.indexOf('new in last 24h')).toBeLessThan(overview.indexOf('districts tracked'));
    expect(overview.indexOf('removed after verification')).toBeLessThan(overview.indexOf('districts tracked'));
    expect(overview.indexOf('pending verification')).toBeLessThan(overview.indexOf('districts tracked'));
    // District stats table is sortable by clicking column headers.
    expect(overview).toContain('id="district-stats"');
    expect(overview).toContain('class="sortable"');
    expect(overview).toContain('data-href="/listings?district=7"');
    expect(overview).toContain('class="row-link"');
    expect(overview).toContain('data-sort-value="7"');
    expect(overview).toContain('function sortBy');

    const allListings = renderListings(buildActiveListings(repo));
    expect(allListings).toContain('Active listings');
    expect(allListings).toContain('id="listings-table"');
    expect(allListings).toContain('class="sortable"');
    // Per-column filters: title text, district/rooms selects, numeric comparators.
    expect(allListings).toContain('id="f-title"');
    expect(allListings).toContain('id="f-district"');
    expect(allListings).toContain('function initFromQuery');
    expect(allListings).toContain('sel.appendChild(opt)');

    // District from URL is pre-selected even when no listings exist in that district yet.
    const filtered = renderListings(buildActiveListings(repo), 8);
    expect(filtered).toContain('<option value="8" selected>8</option>');
    expect(allListings).toContain('id="f-rooms"');
    expect(allListings).toContain('id="f-price-op"');
    expect(allListings).toContain('id="f-price-val"');
    expect(allListings).toContain('id="f-ppm2-op"');
    expect(allListings).toContain('id="f-area-op"');
    expect(allListings).toContain('<option value="7">7</option>'); // district option
    expect(allListings).not.toContain('<option value="0">0</option>');
    expect(allListings).toContain('function matches');

    // New listings reuse the same filterable/sortable table page.
    const newListings = renderNewListings(buildNewListings(repo, () => '2026-06-06T12:00:00.000Z'));
    expect(newListings).toContain('New listings (last 24h)');
    expect(newListings).toContain('id="listings-table"');
    expect(newListings).toContain('id="f-district"');
    expect(newListings).toContain('id="f-price-op"');
    expect(newListings).toContain('function matches');

    const pending = renderPendingVerificationListings(buildPendingVerificationListings(repo));
    expect(pending).toContain('Pending verification');
    expect(pending).toContain('id="listings-table"');
    expect(pending).toContain('id="f-district"');

    const removed = renderVerifiedRemovedListings(buildVerifiedRemovedListings(repo));
    expect(removed).toContain('Removed after verification');
    expect(removed).toContain('id="listings-table"');

    const trends = renderTrends(buildTrends(repo));
    expect(trends).toContain('chart.js');
    expect(trends).toContain('"district":7');
    // Main all-districts tile plus the per-district tile controls.
    expect(trends).toContain('id="main-chart"');
    // Switch to flip the main chart between raw and the moving averages.
    expect(trends).toContain('id="main-series"');
    expect(trends).toContain('<option value="median">Raw data points</option>');
    expect(trends).toContain('<option value="ma5">5-day moving average</option>');
    expect(trends).toContain('<option value="ma20">20-day moving average</option>');
    expect(trends).toContain('buildMainDatasets');
    // Hovering a line or legend label emphasizes it by thickening its stroke and bolding its legend label.
    expect(trends).toContain('datasetIndexAtEvent');
    expect(trends).toContain('setEmphasizedDataset');
    expect(trends).toContain('legendItem.datasetIndex');
    expect(trends).toContain('onLeave');
    expect(trends).toContain('emphasizeHovered');
    expect(trends).toContain('drawBoldLegendLabel');
    expect(trends).toContain('helpers.toFont');
    expect(trends).toContain('helpers.renderText');
    expect(trends).toContain('legendBold');
    expect(trends).toContain("_hoveredDatasetIndex");
    // The selected main series and hidden legend districts persist across refreshes.
    expect(trends).toContain('vienna.trends.mainSeries');
    expect(trends).toContain('vienna.trends.mainHidden');
    expect(trends).toContain('applyMainVisibility');
    expect(trends).toContain('syncHiddenMainDistricts');
    expect(trends).toContain('vienna.trends.tileHidden');
    expect(trends).toContain('applyTileVisibility');
    expect(trends).toContain('syncTileHiddenSeries');
    expect(trends).toContain('id="district-select"');
    expect(trends).toContain('id="add-tile"');
    expect(trends).toContain('<option value="7">District 7</option>');
    expect(trends).toContain('MA 5d');
    expect(trends).toContain('MA 20d');
    // District tiles persist via localStorage and expose maximize/restore/close controls.
    expect(trends).toContain('localStorage');
    expect(trends).toContain('loadSavedDistricts');
    expect(trends).toContain('insertTileSorted');
    expect(trends).toContain('tile-links');
    expect(trends).toContain('View active');
    expect(trends).toContain('View new');
    expect(trends).toContain("'/listings?district=' + district");
    expect(trends).toContain("'/new-listings?district=' + district");
    expect(trends).toContain("className = 'tile-actions'");
    expect(trends).toContain("className = 'maximize'");
    expect(trends).toContain("className = 'restore'");
    expect(trends).toContain("className = 'close'");
    expect(trends).toContain('Maximize District ');
    expect(trends).toContain('Restore District ');
    expect(trends).toContain('Remove District ');
    expect(trends).toContain('function maximizeTile');
    expect(trends).toContain('function restoreTile');
    expect(trends).toContain('tile-maximized');
    expect(trends).toContain('button[hidden] { display: none !important; }');
    expect(trends).toContain("e.key !== 'Escape'");

    const map = renderMap(buildMapData(repo));
    expect(map).toContain('leaflet');
    expect(map).toContain('openstreetmap');
  });

  it('shows willhaben request tiles on overview when configured', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    const summary = buildSummary(
      repo,
      { ...config, showWillhabenRequestStats: true } as AppConfig,
      () => '2026-06-06T12:00:00.000Z',
    );
    const overview = renderOverview(summary);
    expect(overview).toContain('requests last 60s');
    expect(overview).toContain('href="/willhaben-requests"');
    expect(overview).toContain('max requests / min');
    expect(overview).toContain('since startup');
    expect(overview).toContain('avg req/min');
    expect(overview).toContain('uptime');
    expect(overview.indexOf('districts tracked')).toBeLessThan(overview.indexOf('requests last 60s'));
  });

  it('renders empty states', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    const overview = renderOverview(buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z'));
    expect(overview).toContain('No data yet');
    expect(renderTrends(buildTrends(repo))).toContain('No daily stats recorded yet');
    expect(renderListings(buildActiveListings(repo))).toContain('No active listings');
    expect(renderNewListings(buildNewListings(repo, () => '2026-06-06T12:00:00.000Z'))).toContain(
      'No new listings',
    );
    expect(renderPendingVerificationListings(buildPendingVerificationListings(repo))).toContain(
      'No listings pending verification',
    );
    expect(renderVerifiedRemovedListings(buildVerifiedRemovedListings(repo))).toContain(
      'No listings removed after verification',
    );
  });

  it('shows a site-wide banner when willhaben returns HTTP 403', () => {
    const uiAlerts = {
      willhabenAccess: {
        forbidden: true,
        lastForbiddenAt: '2026-06-06T12:00:00.000Z',
        lastSuccessAt: null,
        lastMessage: 'willhaben request failed: 403 Forbidden',
      },
      verificationRateLimit: {
        deferred: false,
        deferredCount: 0,
        lastDeferredAt: null,
        requestsPerMinuteLimit: 50,
      },
    };
    const overview = renderOverview({
      ...buildSummary(repoAt('2026-06-06T12:00:00.000Z'), config),
      uiAlerts,
    });
    expect(overview).toContain('alert-forbidden');
    expect(overview).toContain('HTTP 403');
    expect(overview).toContain('willhaben request failed: 403 Forbidden');

    expect(renderListings([], null, uiAlerts)).toContain('alert-forbidden');
    expect(renderTrends({ dates: [], series: [] }, uiAlerts)).toContain('alert-forbidden');
    expect(renderMap([], uiAlerts)).toContain('alert-forbidden');
  });

  it('shows a site-wide banner when verification is deferred by rate limiting', () => {
    const uiAlerts = {
      willhabenAccess: {
        forbidden: false,
        lastForbiddenAt: null,
        lastSuccessAt: null,
        lastMessage: null,
      },
      verificationRateLimit: {
        deferred: true,
        deferredCount: 3,
        lastDeferredAt: '2026-06-06T12:00:00.000Z',
        requestsPerMinuteLimit: 50,
      },
    };
    const html = renderListings([], null, uiAlerts);
    expect(html).toContain('alert-rate-limit');
    expect(html).toContain('Verification paused (rate limit)');
    expect(html).toContain('50 per minute');
    expect(html).toContain('3 pending verification listings');
  });
});
