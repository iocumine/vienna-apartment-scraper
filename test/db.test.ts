import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createRepository, type Repository } from '../src/db/index.js';
import type { NormalizedListing } from '../src/types.js';

function makeRepo(clock: () => string): Repository {
  return createRepository(new Database(':memory:'), { clock });
}

function listing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: 'a1',
    title: 'Nice flat',
    url: 'https://willhaben.at/1',
    district: 7,
    postcode: 1070,
    rooms: 2,
    area_m2: 50,
    price: 1000,
    price_per_m2: null,
    lat: 48.2,
    lng: 16.3,
    published_at: '2026-06-01T10:00:00.000Z',
    ...over,
  };
}

describe('repository: upsert + dedup', () => {
  let now: string;
  let repo: Repository;
  beforeEach(() => {
    now = '2026-06-01T12:00:00.000Z';
    repo = makeRepo(() => now);
  });

  it('inserts a new listing and computes price_per_m2', () => {
    const res = repo.upsertListing(listing());
    expect(res.isNew).toBe(true);
    expect(res.pricePerM2).toBe(20);
    const row = repo.getListingById('a1')!;
    expect(row.price_per_m2).toBe(20);
    expect(row.is_active).toBe(1);
    expect(row.first_seen_at).toBe(now);
  });

  it('does not duplicate on re-seeing the same id', () => {
    repo.upsertListing(listing());
    const first = repo.getListingById('a1')!.first_seen_at;
    now = '2026-06-02T12:00:00.000Z';
    const res = repo.upsertListing(listing({ price: 1100 }));
    expect(res.isNew).toBe(false);
    const row = repo.getListingById('a1')!;
    expect(row.first_seen_at).toBe(first);
    expect(row.last_seen_at).toBe(now);
    expect(row.price).toBe(1100);
    expect(repo.countActive()).toBe(1);
  });

  it('upsertMany returns new/existing flags per listing', () => {
    const res = repo.upsertMany([listing({ id: 'a1' }), listing({ id: 'a2' })]);
    expect(res.map((r) => r.isNew)).toEqual([true, true]);
    const res2 = repo.upsertMany([listing({ id: 'a1' }), listing({ id: 'a3' })]);
    expect(res2.map((r) => r.isNew)).toEqual([false, true]);
  });
});

describe('repository: deactivation', () => {
  it('deactivates listings not seen in the latest run', () => {
    let now = '2026-06-01T12:00:00.000Z';
    const repo = createRepository(new Database(':memory:'), { clock: () => now });
    repo.upsertListing(listing({ id: 'a1' }));
    repo.upsertListing(listing({ id: 'a2' }));

    const runStart = '2026-06-02T12:00:00.000Z';
    now = '2026-06-02T12:00:01.000Z';
    repo.upsertListing(listing({ id: 'a1' }));
    const changed = repo.deactivateNotSeenSince(runStart);
    expect(changed).toBe(1);
    expect(repo.getListingById('a1')!.is_active).toBe(1);
    expect(repo.getListingById('a2')!.is_active).toBe(0);
    expect(repo.countActive()).toBe(1);
  });
});

describe('repository: stats aggregation', () => {
  it('computes avg/median sqm price and count per district', () => {
    const repo = makeRepo(() => '2026-06-01T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'a2', district: 7, price: 1500, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'b1', district: 9, price: 2000, area_m2: 50 }));

    const stats = repo.computeCurrentDistrictStats();
    expect(stats).toEqual([
      { district: 7, avg_price_per_m2: 25, median_price_per_m2: 25, active_count: 2 },
      { district: 9, avg_price_per_m2: 40, median_price_per_m2: 40, active_count: 1 },
    ]);
  });

  it('snapshots daily stats and reads them back', () => {
    const repo = makeRepo(() => '2026-06-01T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    const written = repo.snapshotDailyStats();
    expect(written[0]).toMatchObject({ date: '2026-06-01', district: 7, active_count: 1 });
    const history = repo.getDistrictStatsHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.median_price_per_m2).toBe(20);
  });

  it('snapshot is idempotent for the same day', () => {
    const repo = makeRepo(() => '2026-06-01T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    repo.snapshotDailyStats();
    repo.snapshotDailyStats();
    expect(repo.getDistrictStatsHistory()).toHaveLength(1);
  });

  it('computes period medians from daily snapshot history', () => {
    const repo = makeRepo(() => '2026-06-10T12:00:00.000Z');
    repo.upsertDailyStats({ date: '2026-06-01', district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 3 });
    repo.upsertDailyStats({ date: '2026-06-02', district: 7, median_price_per_m2: 30, avg_price_per_m2: 30, active_count: 4 });
    repo.upsertDailyStats({ date: '2026-06-01', district: 9, median_price_per_m2: 40, avg_price_per_m2: 40, active_count: 2 });
    // Current active listings: district 7 has two, district 9 has none in live data.
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'a2', district: 7, price: 1500, area_m2: 50 }));

    const stats = repo.computePeriodDistrictStats();
    expect(stats).toEqual([
      { district: 7, avg_price_per_m2: 25, median_price_per_m2: 25, active_count: 2 },
      { district: 9, avg_price_per_m2: 40, median_price_per_m2: 40, active_count: 0 },
    ]);
  });

  it('falls back to live stats when no daily history exists yet', () => {
    const repo = makeRepo(() => '2026-06-01T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    expect(repo.computePeriodDistrictStats()).toEqual(repo.computeCurrentDistrictStats());
  });
});

describe('repository: baselines', () => {
  it('uses recorded daily medians within the window', () => {
    const repo = makeRepo(() => '2026-06-10T12:00:00.000Z');
    repo.upsertDailyStats({ date: '2026-06-08', district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 3 });
    repo.upsertDailyStats({ date: '2026-06-09', district: 7, median_price_per_m2: 24, avg_price_per_m2: 24, active_count: 3 });
    const baseline = repo.getDistrictBaseline(7, 30, '2026-06-10');
    expect(baseline).toBe(22);
  });

  it('falls back to live active median when no history exists', () => {
    const repo = makeRepo(() => '2026-06-10T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    repo.upsertListing(listing({ id: 'a2', district: 7, price: 1600, area_m2: 50 }));
    const baseline = repo.getDistrictBaseline(7, 30, '2026-06-10');
    expect(baseline).toBe(26);
  });

  it('ignores daily stats outside the window', () => {
    const repo = makeRepo(() => '2026-06-10T12:00:00.000Z');
    repo.upsertDailyStats({ date: '2026-01-01', district: 7, median_price_per_m2: 99, avg_price_per_m2: 99, active_count: 1 });
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    const baseline = repo.getDistrictBaseline(7, 30, '2026-06-10');
    expect(baseline).toBe(20);
  });
});

describe('repository: alerts dedup + map', () => {
  it('records and detects sent alerts', () => {
    const repo = makeRepo(() => '2026-06-01T12:00:00.000Z');
    expect(repo.hasAlertBeenSent('a1', 'below_market')).toBe(false);
    repo.recordAlertSent('a1', 'below_market');
    expect(repo.hasAlertBeenSent('a1', 'below_market')).toBe(true);
    repo.recordAlertSent('a1', 'below_market');
    expect(repo.hasAlertBeenSent('a1', 'below_market')).toBe(true);
  });

  it('returns active listings with coordinates for the map', () => {
    const repo = makeRepo(() => '2026-06-01T12:00:00.000Z');
    repo.upsertListing(listing({ id: 'a1', lat: 48.2, lng: 16.3 }));
    repo.upsertListing(listing({ id: 'a2', lat: null, lng: null }));
    const mapped = repo.getListingsForMap();
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.id).toBe('a1');
  });

  it('returns new listings since a timestamp', () => {
    let now = '2026-06-01T12:00:00.000Z';
    const repo = createRepository(new Database(':memory:'), { clock: () => now });
    repo.upsertListing(listing({ id: 'old' }));
    now = '2026-06-03T12:00:00.000Z';
    repo.upsertListing(listing({ id: 'new' }));
    const rows = repo.getNewListingsSince('2026-06-02T00:00:00.000Z');
    expect(rows.map((r) => r.id)).toEqual(['new']);
  });
});
