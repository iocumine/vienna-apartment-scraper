import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createRepository, type Repository } from '../src/db/index.js';
import { buildSummary, buildTrends, buildMapData } from '../src/web/data.js';
import { renderOverview, renderTrends, renderMap } from '../src/web/views.js';
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

const config = {} as AppConfig;

describe('buildSummary', () => {
  it('counts active and last-24h listings plus district stats', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'a2', district: 9, price: 1500, area_m2: 50 }));
    const summary = buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z');
    expect(summary.activeCount).toBe(2);
    expect(summary.newCount).toBe(2);
    expect(summary.districts.map((d) => d.district)).toEqual([7, 9]);
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

describe('views render valid html', () => {
  it('renders overview, trends, and map', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50, lat: 48.2, lng: 16.3 }));
    repo.upsertDailyStats({ date: '2026-06-01', district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 1 });

    const overview = renderOverview(buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z'));
    expect(overview).toContain('<!doctype html>');
    expect(overview).toContain('Overview');

    const trends = renderTrends(buildTrends(repo));
    expect(trends).toContain('chart.js');
    expect(trends).toContain('"district":7');

    const map = renderMap(buildMapData(repo));
    expect(map).toContain('leaflet');
    expect(map).toContain('openstreetmap');
  });

  it('renders empty states', () => {
    const repo = repoAt('2026-06-06T12:00:00.000Z');
    const overview = renderOverview(buildSummary(repo, config, () => '2026-06-06T12:00:00.000Z'));
    expect(overview).toContain('No data yet');
    expect(renderTrends(buildTrends(repo))).toContain('No daily stats recorded yet');
  });
});
