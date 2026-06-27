import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createRepository, type Repository } from '../src/db/index.js';
import { runPoll } from '../src/jobs/poll.js';
import { runStatsSnapshot } from '../src/jobs/computeStats.js';
import {
  summarizeNewListings,
  renderDailyReportText,
  renderDailyReportHtml,
  runDailyReport,
} from '../src/jobs/dailyReport.js';
import type { AppConfig, ListingRow, NormalizedListing } from '../src/types.js';

function repoWithClock(clockRef: { now: string }): Repository {
  return createRepository(new Database(':memory:'), { clock: () => clockRef.now });
}

function listing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: 'a1',
    title: 'Flat',
    url: 'https://willhaben.at/1',
    district: 7,
    postcode: 1070,
    rooms: 2,
    area_m2: 50,
    price: 1000,
    price_per_m2: null,
    lat: 48.2,
    lng: 16.3,
    published_at: null,
    ...over,
  };
}

const baseConfig = {
  transactionType: 'rent',
  districts: [7, 9],
  roomsMin: 1,
  roomsMax: 2,
  alertThresholdPct: 0.15,
  statsWindowDays: 30,
  alertEmailTo: ['you@x.com'],
  reportEmailTo: ['you@x.com'],
  verificationMissThreshold: 5,
  requestDelayMs: 0,
} as AppConfig;

describe('runPoll', () => {
  it('inserts scraped listings, increments miss count for stale, and keeps them active', async () => {
    const clock = { now: '2026-06-01T12:00:00.000Z' };
    const repo = repoWithClock(clock);
    repo.upsertListing(listing({ id: 'stale', price: 1000, area_m2: 50 }));

    clock.now = '2026-06-02T12:00:01.000Z';
    const scraped = [listing({ id: 'a1' }), listing({ id: 'a2', district: 9 })];
    const scrapeFn = async () => scraped;
    const res = await runPoll({
      repo,
      config: baseConfig,
      scrapeFn,
      verifyFn: async () => ({ checked: 0, deactivated: 0, reconfirmed: 0 }),
      now: () => '2026-06-02T12:00:00.000Z',
      logger: { info() {}, warn() {} },
    });

    expect(res.total).toBe(2);
    expect(res.newCount).toBe(2);
    expect(res.missed).toBe(1);
    expect(res.deactivated).toBe(0);
    expect(repo.getListingById('stale')!.is_active).toBe(1);
    expect(repo.getListingById('stale')!.miss_count).toBe(1);
    expect(repo.countActive()).toBe(3);
  });

  it('deactivates after verification confirms listing is gone', async () => {
    const clock = { now: '2026-06-01T12:00:00.000Z' };
    const repo = repoWithClock(clock);
    repo.upsertListing(listing({ id: 'stale', price: 1000, area_m2: 50 }));
    repo.db
      .prepare(`UPDATE listings SET last_seen_at = ?, miss_count = 5 WHERE id = 'stale'`)
      .run('2026-06-01T00:00:00.000Z');

    clock.now = '2026-06-02T12:00:01.000Z';
    const res = await runPoll({
      repo,
      config: baseConfig,
      scrapeFn: async () => [listing({ id: 'a1' })],
      verifyDeps: {
        verifyListingFn: async (id) => id !== 'stale',
        sleep: async () => {},
      },
      now: () => '2026-06-02T12:00:00.000Z',
      logger: { info() {}, warn() {} },
    });

    expect(res.verified).toBe(1);
    expect(res.deactivated).toBe(1);
    expect(repo.getListingById('stale')!.is_active).toBe(0);
    expect(repo.countActive()).toBe(1);
  });

  it('shares one rate limiter between scrape and verification', async () => {
    const acquire = vi.fn(async () => {});
    const rateLimiter = { acquire };
    const repo = repoWithClock({ now: '2026-06-10T12:00:00.000Z' });
    repo.upsertListing(listing({ id: 'stale' }));
    repo.db
      .prepare(`UPDATE listings SET last_seen_at = ?, miss_count = 5 WHERE id = 'stale'`)
      .run('2026-06-09T00:00:00.000Z');

    await runPoll({
      repo,
      config: baseConfig,
      scrapeFn: async (_cfg, deps) => {
        await deps?.rateLimiter?.acquire();
        return [listing({ id: 'a1' })];
      },
      verifyDeps: {
        verifyListingFn: async (_id, _tx, deps) => {
          await deps.rateLimiter?.acquire();
          return true;
        },
        sleep: async () => {},
      },
      scrapeDeps: { rateLimiter },
      now: () => '2026-06-10T12:00:00.000Z',
      logger: { info() {}, warn() {} },
    });
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it('fires an alert for a below-market new listing', async () => {
    const clock = { now: '2026-06-01T12:00:00.000Z' };
    const repo = repoWithClock(clock);
    // Establish a district baseline via daily stats.
    repo.upsertDailyStats({ date: '2026-06-01', district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 5 });

    const emails: unknown[] = [];
    const email = { send: async (m: unknown) => { emails.push(m); } };
    const cheap = listing({ id: 'cheap', price: 800, area_m2: 50, price_per_m2: 16 }); // 20% below
    const res = await runPoll({
      repo,
      config: baseConfig,
      email,
      scrapeFn: async () => [cheap],
      now: () => '2026-06-01T13:00:00.000Z',
      logger: { info() {}, warn() {} },
    });
    expect(res.alerts).toBe(1);
    expect(emails).toHaveLength(1);
  });
});

describe('runStatsSnapshot', () => {
  it('snapshots the current day per-district stats', () => {
    const clock = { now: '2026-06-05T12:00:00.000Z' };
    const repo = repoWithClock(clock);
    repo.upsertListing(listing({ id: 'a1', district: 7, price: 1000, area_m2: 50 }));
    const rows = runStatsSnapshot({ repo, now: () => '2026-06-05T23:00:00.000Z', logger: { info() {} } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-06-05', district: 7 });
  });
});

describe('daily report', () => {
  const rows: ListingRow[] = [
    {
      id: 'a1', first_seen_at: '', last_seen_at: '', is_active: 1, miss_count: 0, title: 'Cheap',
      url: 'http://x/1', district: 7, postcode: 1070, rooms: 2, area_m2: 50,
      price: 800, price_per_m2: 16, lat: null, lng: null, published_at: null, raw_json: null,
    },
    {
      id: 'a2', first_seen_at: '', last_seen_at: '', is_active: 1, miss_count: 0, title: 'Pricey',
      url: 'http://x/2', district: 7, postcode: 1070, rooms: 2, area_m2: 50,
      price: 1200, price_per_m2: 24, lat: null, lng: null, published_at: null, raw_json: null,
    },
  ];

  it('groups by district with baseline delta, cheapest first', () => {
    const summary = summarizeNewListings(rows, () => 20);
    expect(summary.count).toBe(2);
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0]!.listings.map((l) => l.id)).toEqual(['a1', 'a2']);
    expect(summary.groups[0]!.listings[0]!.deltaPct).toBeCloseTo(0.2);
  });

  it('renders text and html', () => {
    const summary = summarizeNewListings(rows, () => 20);
    expect(renderDailyReportText(summary, '2026-06-05')).toContain('District 7');
    expect(renderDailyReportHtml(summary, '2026-06-05')).toContain('<table');
  });

  it('renders an empty report', () => {
    const empty = summarizeNewListings([], () => 20);
    expect(renderDailyReportText(empty, '2026-06-05')).toContain('No new apartments');
    expect(renderDailyReportHtml(empty, '2026-06-05')).toContain('No new apartments');
  });

  it('renders listings with null fields using fallbacks', () => {
    const sparse: ListingRow[] = [
      {
        id: 's1', first_seen_at: '', last_seen_at: '', is_active: 1, miss_count: 0, title: null,
        url: null, district: 7, postcode: null, rooms: null, area_m2: null,
        price: null, price_per_m2: null, lat: null, lng: null, published_at: null, raw_json: null,
      },
    ];
    const summary = summarizeNewListings(sparse, () => null);
    const text = renderDailyReportText(summary, '2026-06-05');
    expect(text).toContain('Untitled');
    const html = renderDailyReportHtml(summary, '2026-06-05');
    expect(html).toContain('Untitled');
  });

  it('runDailyReport queries the last 24h and emails the summary', async () => {
    const clock = { now: '2026-06-05T00:00:00.000Z' };
    const repo = repoWithClock(clock);
    repo.upsertListing(listing({ id: 'old', district: 7, price: 1000, area_m2: 50 }));
    clock.now = '2026-06-06T10:00:00.000Z';
    repo.upsertListing(listing({ id: 'fresh', district: 7, price: 900, area_m2: 50 }));

    const emails: Array<{ subject: string }> = [];
    const email = { send: async (m: { subject: string }) => { emails.push(m); } };
    const summary = await runDailyReport({
      repo,
      config: baseConfig,
      email,
      now: () => '2026-06-06T12:00:00.000Z',
      logger: { info() {}, warn() {} },
    });
    expect(summary.count).toBe(1);
    expect(summary.groups[0]!.listings[0]!.id).toBe('fresh');
    expect(emails[0]!.subject).toContain('1 new');
  });
});
