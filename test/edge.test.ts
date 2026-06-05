import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase, createRepository, type Repository } from '../src/db/index.js';
import { createEmailer } from '../src/alerts/email.js';
import { formatAlertText, formatAlertHtml } from '../src/alerts/format.js';
import { notifyBelowMarket } from '../src/alerts/notify.js';
import { normalizeAdvert, parseEuroNumber } from '../src/scraper/willhaben.js';
import { pricePerM2, average } from '../src/lib/metrics.js';
import { runStatsSnapshot } from '../src/jobs/computeStats.js';
import { runPoll } from '../src/jobs/poll.js';
import { runDailyReport } from '../src/jobs/dailyReport.js';
import { buildSummary, buildMapData } from '../src/web/data.js';
import type { AppConfig, NormalizedListing } from '../src/types.js';

function listing(over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: 'a1', title: 'Flat', url: 'https://willhaben.at/1', district: 7, postcode: 1070,
    rooms: 2, area_m2: 50, price: 1000, price_per_m2: 20, lat: 48.2, lng: 16.3,
    published_at: null, ...over,
  };
}

describe('metrics edge branches', () => {
  it('rejects negative or non-numeric price/area', () => {
    expect(pricePerM2(-1000, 50)).toBeNull();
    expect(pricePerM2(1000, -50)).toBeNull();
    expect(pricePerM2('x', 50)).toBeNull();
  });
  it('average of only non-finite or empty is null', () => {
    expect(average(['x', NaN, 'y'] as unknown[])).toBeNull();
    expect(average(undefined as unknown as unknown[])).toBeNull();
  });
});

describe('parseEuroNumber US thousands format', () => {
  it('parses "1,234.56" by removing comma thousands', () => {
    expect(parseEuroNumber('1,234.56')).toBe(1234.56);
  });
});

describe('scraper normalize edge branches', () => {
  it('handles absolute SEO_URL, HEADING title fallback, string date, missing coords', () => {
    const advert = {
      id: 9,
      attributes: {
        attribute: [
          { name: 'HEADING', values: ['From heading'] },
          { name: 'PRICE', values: ['1000'] },
          { name: 'ESTATE_SIZE', values: ['50'] },
          { name: 'POSTCODE', values: ['1070'] },
          { name: 'SEO_URL', values: ['https://absolute.example/listing'] },
          { name: 'PUBLISHED', values: ['2026-06-01T00:00:00.000Z'] },
        ],
      },
    };
    const n = normalizeAdvert(advert)!;
    expect(n.title).toBe('From heading');
    expect(n.url).toBe('https://absolute.example/listing');
    expect(n.lat).toBeNull();
    expect(n.published_at).toBe(new Date('2026-06-01T00:00:00.000Z').toISOString());
  });

  it('returns null published_at for unparseable dates', () => {
    const advert = { id: 10, attributes: { attribute: [{ name: 'PUBLISHED', values: ['not-a-date'] }] } };
    expect(normalizeAdvert(advert)!.published_at).toBeNull();
  });
});

describe('format missing fields', () => {
  it('uses fallbacks for null fields', () => {
    const r = { triggered: true, pricePerM2: null, baseline: null, deltaPct: null };
    const text = formatAlertText(
      { title: null, url: null, district: null, rooms: null, area_m2: null, price: null, price_per_m2: null },
      r,
    );
    expect(text).toContain('Untitled');
    const html = formatAlertHtml({ title: null, url: null }, r);
    expect(html).toContain('Untitled');
  });
});

describe('email without injected transport', () => {
  it('builds a real transport with auth', () => {
    const emailer = createEmailer({ host: 'smtp.x', port: 465, secure: true, user: 'u@x.com', pass: 'p', from: 'u@x.com' });
    expect(typeof emailer.send).toBe('function');
  });
  it('builds a transport without auth when user empty', () => {
    const emailer = createEmailer({ host: 'smtp.x', port: 587, secure: false, user: '', pass: '', from: '' });
    expect(typeof emailer.send).toBe('function');
  });
  it('falls back to user as the from address when from is empty', async () => {
    const sent: Record<string, unknown>[] = [];
    const emailer = createEmailer(
      { host: 'h', port: 1, secure: true, user: 'u@x.com', pass: 'p', from: '' },
      { transport: { sendMail: async (o) => { sent.push(o); return {}; } } },
    );
    await emailer.send({ to: 'to@x.com', subject: 's', text: 't' });
    expect(sent[0]!.from).toBe('u@x.com');
  });
});

describe('notify channel branches', () => {
  const cfg = {
    alertThresholdPct: 0.15,
    statsWindowDays: 30,
    alertEmailTo: 'you@x.com',
    whatsapp: { enabled: false, to: '', authDir: '' },
  } as AppConfig;

  it('skips whatsapp when disabled and uses email only', async () => {
    const repo = createRepository(new Database(':memory:'));
    repo.upsertDailyStats({ date: new Date().toISOString().slice(0, 10), district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 5 });
    const emails: unknown[] = [];
    const whats: unknown[] = [];
    const fired = await notifyBelowMarket({
      repo,
      config: cfg,
      listings: [listing({ id: 'cheap', price_per_m2: 10 })],
      email: { send: async (m) => { emails.push(m); } },
      whatsapp: { send: async (n, t) => { whats.push({ n, t }); }, close: async () => {}, enabled: true },
    });
    expect(fired).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(whats).toHaveLength(0); // disabled in config
  });

  it('skips whatsapp when recipient number is empty', async () => {
    const repo = createRepository(new Database(':memory:'));
    repo.upsertDailyStats({ date: new Date().toISOString().slice(0, 10), district: 7, median_price_per_m2: 20, avg_price_per_m2: 20, active_count: 5 });
    const whats: unknown[] = [];
    const cfgNoNumber = { ...cfg, whatsapp: { enabled: true, to: '', authDir: '' } } as AppConfig;
    const fired = await notifyBelowMarket({
      repo,
      config: cfgNoNumber,
      listings: [listing({ id: 'cheap', price_per_m2: 10 })],
      email: { send: async () => {} },
      whatsapp: { send: async (n, t) => { whats.push({ n, t }); }, close: async () => {}, enabled: true },
    });
    expect(fired).toHaveLength(1);
    expect(whats).toHaveLength(0);
  });
});

describe('db extra coverage', () => {
  it('openDatabase works for in-memory and file paths', () => {
    const mem = openDatabase(':memory:');
    mem.upsertListing(listing());
    expect(mem.getActiveListings()).toHaveLength(1);
    expect(mem.round2(1.239)).toBe(1.24);
    mem.close();

    const file = path.join(os.tmpdir(), `vienna-test-${Date.now()}.db`);
    const repo: Repository = openDatabase(file);
    repo.upsertListing(listing());
    expect(repo.countActive()).toBe(1);
    repo.close();
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  });
});

describe('jobs run with default deps', () => {
  const cfg = {
    transactionType: 'rent', districts: [7], roomsMin: 1, roomsMax: 2,
    alertThresholdPct: 0.15, statsWindowDays: 30, alertEmailTo: '', reportEmailTo: '',
    whatsapp: { enabled: false, to: '', authDir: '' },
  } as AppConfig;

  it('runStatsSnapshot/runPoll/runDailyReport use default now+logger', async () => {
    const repo = createRepository(new Database(':memory:'));
    repo.upsertListing(listing({ id: 'a1' }));
    expect(runStatsSnapshot({ repo }).length).toBe(1);

    const res = await runPoll({ repo, config: cfg, scrapeFn: async () => [] });
    expect(res.total).toBe(0);

    const summary = await runDailyReport({ repo, config: cfg });
    expect(summary).toHaveProperty('count');
  });

  it('runDailyReport swallows email send failures', async () => {
    const repo = createRepository(new Database(':memory:'));
    repo.upsertListing(listing({ id: 'fresh' }));
    const warns: string[] = [];
    const cfgWithEmail = { ...cfg, reportEmailTo: 'you@x.com' } as AppConfig;
    const summary = await runDailyReport({
      repo,
      config: cfgWithEmail,
      email: { send: async () => { throw new Error('smtp down'); } },
      logger: { info() {}, warn: (m) => warns.push(String(m)) },
    });
    expect(summary.count).toBe(1);
    expect(warns.some((w) => w.includes('daily report email failed'))).toBe(true);
  });
});

describe('web data default + null-district branches', () => {
  it('buildSummary uses default now', () => {
    const repo = createRepository(new Database(':memory:'));
    repo.upsertListing(listing());
    expect(buildSummary(repo, {} as AppConfig).activeCount).toBe(1);
  });

  it('buildMapData handles null district and missing median', () => {
    const repo = createRepository(new Database(':memory:'));
    repo.upsertListing(listing({ id: 'nd', district: null, postcode: null, lat: 48.2, lng: 16.3 }));
    const points = buildMapData(repo);
    expect(points).toHaveLength(1);
    expect(points[0]!.districtMedian).toBeNull();
    expect(points[0]!.belowMedian).toBe(false);
  });

  it('buildMapData fills null fields and handles a null sqm price', () => {
    const repo = createRepository(new Database(':memory:'));
    // A normal listing establishes the district median.
    repo.upsertListing(listing({ id: 'normal', district: 7, price: 1000, area_m2: 50, lat: 48.2, lng: 16.3 }));
    // A geocoded listing with no price/area (null sqm) and null text fields.
    repo.upsertListing(listing({
      id: 'sparse', district: 7, title: null, url: null, rooms: null,
      area_m2: null, price: null, price_per_m2: null, lat: 48.25, lng: 16.35,
    }));
    const points = buildMapData(repo);
    const sparse = points.find((p) => p.id === 'sparse')!;
    expect(sparse.title).toBeNull();
    expect(sparse.url).toBeNull();
    expect(sparse.price_per_m2).toBeNull();
    expect(sparse.districtMedian).toBe(20);
    expect(sparse.belowMedian).toBe(false);
  });
});
