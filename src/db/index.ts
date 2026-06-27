import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { average, median, pricePerM2, round2 } from '../lib/metrics.js';
import { pickVerificationMissThreshold } from '../config.js';
import type { DailyStatRow, DistrictStat, ListingRow, NormalizedListing } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// schema.sql sits next to this file in both src/ (dev via tsx) and dist/ (built).
const SCHEMA_PATH = fs.existsSync(path.join(__dirname, 'schema.sql'))
  ? path.join(__dirname, 'schema.sql')
  : path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql');

export function migrate(db: DB): DB {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  const cols = db.prepare('PRAGMA table_info(listings)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'miss_count')) {
    db.exec('ALTER TABLE listings ADD COLUMN miss_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'verification_miss_threshold')) {
    db.exec(
      'ALTER TABLE listings ADD COLUMN verification_miss_threshold INTEGER NOT NULL DEFAULT 5',
    );
  }
  return db;
}

function nowIso(): string {
  return new Date().toISOString();
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

interface UpsertResult {
  isNew: boolean;
  pricePerM2: number | null;
}

export interface RepositoryOptions {
  clock?: () => string;
  verificationMissThresholdMin?: number;
  verificationMissThresholdMax?: number;
  random?: () => number;
}

const DEFAULT_VERIFICATION_MISS_THRESHOLD_MIN = 10;
const DEFAULT_VERIFICATION_MISS_THRESHOLD_MAX = 50;

// Wraps a better-sqlite3 connection with the queries the app needs.
export function createRepository(db: DB, options: RepositoryOptions = {}) {
  migrate(db);
  const {
    clock = nowIso,
    verificationMissThresholdMin = DEFAULT_VERIFICATION_MISS_THRESHOLD_MIN,
    verificationMissThresholdMax = DEFAULT_VERIFICATION_MISS_THRESHOLD_MAX,
    random = Math.random,
  } = options;

  const insertStmt = db.prepare(`
    INSERT INTO listings (id, first_seen_at, last_seen_at, is_active, miss_count,
      verification_miss_threshold, title, url,
      district, postcode, rooms, area_m2, price, price_per_m2, lat, lng, published_at, raw_json)
    VALUES (@id, @ts, @ts, 1, 0, @verification_miss_threshold, @title, @url, @district, @postcode,
      @rooms, @area_m2, @price, @price_per_m2, @lat, @lng, @published_at, @raw_json)
  `);

  const updateStmt = db.prepare(`
    UPDATE listings SET last_seen_at = @ts, is_active = 1, miss_count = 0, title = @title, url = @url,
      district = @district, postcode = @postcode, rooms = @rooms, area_m2 = @area_m2,
      price = @price, price_per_m2 = @price_per_m2, lat = @lat, lng = @lng,
      published_at = @published_at, raw_json = @raw_json
    WHERE id = @id
  `);

  const existsStmt = db.prepare('SELECT id FROM listings WHERE id = ?');

  function upsertListing(listing: NormalizedListing): UpsertResult {
    const ts = clock();
    const ppm2 = listing.price_per_m2 ?? pricePerM2(listing.price, listing.area_m2);
    const row = {
      ts,
      id: String(listing.id),
      title: listing.title ?? null,
      url: listing.url ?? null,
      district: listing.district ?? null,
      postcode: listing.postcode ?? null,
      rooms: listing.rooms ?? null,
      area_m2: listing.area_m2 ?? null,
      price: listing.price ?? null,
      price_per_m2: ppm2,
      lat: listing.lat ?? null,
      lng: listing.lng ?? null,
      published_at: listing.published_at ?? null,
      raw_json: listing.raw_json ?? (listing.raw ? JSON.stringify(listing.raw) : null),
    };
    const exists = existsStmt.get(row.id);
    if (exists) {
      updateStmt.run(row);
      return { isNew: false, pricePerM2: ppm2 };
    }
    insertStmt.run({
      ...row,
      verification_miss_threshold: pickVerificationMissThreshold(
        verificationMissThresholdMin,
        verificationMissThresholdMax,
        random,
      ),
    });
    return { isNew: true, pricePerM2: ppm2 };
  }

  const upsertMany = db.transaction((listings: NormalizedListing[]) => {
    const results: Array<UpsertResult & { id: string }> = [];
    for (const l of listings) results.push({ id: String(l.id), ...upsertListing(l) });
    return results;
  });

  function deactivateNotSeenSince(sinceIso: string): number {
    const info = db
      .prepare('UPDATE listings SET is_active = 0 WHERE last_seen_at < ? AND is_active = 1')
      .run(sinceIso);
    return info.changes;
  }

  function incrementMissCountForNotSeenSince(sinceIso: string): number {
    const info = db
      .prepare(
        `UPDATE listings SET miss_count = miss_count + 1
         WHERE is_active = 1 AND last_seen_at < ?`,
      )
      .run(sinceIso);
    return info.changes;
  }

  function getListingsForVerification(maxLastSeenAt: string): ListingRow[] {
    return db
      .prepare(
        `SELECT * FROM listings
         WHERE is_active = 1
           AND miss_count >= verification_miss_threshold
           AND last_seen_at <= ?
         ORDER BY last_seen_at ASC`,
      )
      .all(maxLastSeenAt) as ListingRow[];
  }

  function resetMissCount(id: string): void {
    db.prepare('UPDATE listings SET miss_count = 0 WHERE id = ?').run(String(id));
  }

  function deactivateListing(id: string): void {
    db.prepare('UPDATE listings SET is_active = 0 WHERE id = ?').run(String(id));
  }

  function getActiveListings(): ListingRow[] {
    return db.prepare('SELECT * FROM listings WHERE is_active = 1').all() as ListingRow[];
  }

  function getListingById(id: string): ListingRow | undefined {
    return db.prepare('SELECT * FROM listings WHERE id = ?').get(String(id)) as
      | ListingRow
      | undefined;
  }

  function getNewListingsSince(sinceIso: string): ListingRow[] {
    return db
      .prepare('SELECT * FROM listings WHERE first_seen_at >= ? ORDER BY first_seen_at DESC')
      .all(sinceIso) as ListingRow[];
  }

  // Aggregate current active listings into per-district avg/median sqm price + count.
  function computeCurrentDistrictStats(): DistrictStat[] {
    const rows = db
      .prepare(
        `SELECT district, price_per_m2 FROM listings
         WHERE is_active = 1 AND district IS NOT NULL`,
      )
      .all() as Array<{ district: number; price_per_m2: number | null }>;
    const byDistrict = new Map<number, number[]>();
    for (const r of rows) {
      if (!byDistrict.has(r.district)) byDistrict.set(r.district, []);
      if (r.price_per_m2 !== null && Number.isFinite(r.price_per_m2)) {
        byDistrict.get(r.district)!.push(r.price_per_m2);
      }
    }
    return [...byDistrict.entries()]
      .map(([district, values]) => ({
        district,
        avg_price_per_m2: average(values),
        median_price_per_m2: median(values),
        active_count: values.length,
      }))
      .sort((a, b) => a.district - b.district);
  }

  // Aggregate daily snapshot history into per-district period medians. Less volatile
  // than a single day's active listings. Active count still reflects current listings.
  function computePeriodDistrictStats(): DistrictStat[] {
    const rows = db
      .prepare(
        `SELECT district, avg_price_per_m2, median_price_per_m2 FROM district_daily_stats`,
      )
      .all() as Array<{
      district: number;
      avg_price_per_m2: number | null;
      median_price_per_m2: number | null;
    }>;
    const byDistrict = new Map<number, { avgs: number[]; medians: number[] }>();
    for (const r of rows) {
      if (!byDistrict.has(r.district)) byDistrict.set(r.district, { avgs: [], medians: [] });
      const bucket = byDistrict.get(r.district)!;
      if (r.median_price_per_m2 !== null && Number.isFinite(r.median_price_per_m2)) {
        bucket.medians.push(r.median_price_per_m2);
      }
      if (r.avg_price_per_m2 !== null && Number.isFinite(r.avg_price_per_m2)) {
        bucket.avgs.push(r.avg_price_per_m2);
      }
    }

    const currentStats = computeCurrentDistrictStats();
    if (byDistrict.size === 0) return currentStats;

    const stats = [...byDistrict.entries()]
      .map(([district, { avgs, medians }]) => ({
        district,
        avg_price_per_m2: average(avgs),
        median_price_per_m2: median(medians),
        active_count: currentStats.find((s) => s.district === district)?.active_count ?? 0,
      }))
      .sort((a, b) => a.district - b.district);

    const seen = new Set(stats.map((s) => s.district));
    for (const live of currentStats) {
      if (!seen.has(live.district)) stats.push(live);
    }
    return stats.sort((a, b) => a.district - b.district);
  }

  const upsertDailyStatsStmt = db.prepare(`
    INSERT INTO district_daily_stats (date, district, avg_price_per_m2, median_price_per_m2, active_count)
    VALUES (@date, @district, @avg_price_per_m2, @median_price_per_m2, @active_count)
    ON CONFLICT(date, district) DO UPDATE SET
      avg_price_per_m2 = excluded.avg_price_per_m2,
      median_price_per_m2 = excluded.median_price_per_m2,
      active_count = excluded.active_count
  `);

  function upsertDailyStats(stat: DailyStatRow): void {
    upsertDailyStatsStmt.run({
      date: stat.date,
      district: stat.district,
      avg_price_per_m2: stat.avg_price_per_m2 ?? null,
      median_price_per_m2: stat.median_price_per_m2 ?? null,
      active_count: stat.active_count ?? 0,
    });
  }

  // Snapshot today's per-district stats. Returns the rows written.
  function snapshotDailyStats(date: string = dayOf(clock())): DailyStatRow[] {
    const stats = computeCurrentDistrictStats();
    const tx = db.transaction(() => {
      for (const s of stats) upsertDailyStats({ date, ...s });
    });
    tx();
    return stats.map((s) => ({ date, ...s }));
  }

  function getDistrictStatsHistory(): DailyStatRow[] {
    return db
      .prepare('SELECT * FROM district_daily_stats ORDER BY date ASC, district ASC')
      .all() as DailyStatRow[];
  }

  // Trailing baseline median sqm price for a district from recorded daily stats.
  // Falls back to the current active-listing median when no history exists yet.
  function getDistrictBaseline(
    district: number,
    windowDays = 30,
    refDate: string = dayOf(clock()),
  ): number | null {
    const ref = new Date(`${refDate}T00:00:00Z`);
    const from = new Date(ref.getTime() - windowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const rows = db
      .prepare(
        `SELECT median_price_per_m2 FROM district_daily_stats
         WHERE district = ? AND date >= ? AND median_price_per_m2 IS NOT NULL`,
      )
      .all(district, from) as Array<{ median_price_per_m2: number }>;
    const fromHistory = median(rows.map((r) => r.median_price_per_m2));
    if (fromHistory !== null) return fromHistory;

    const live = db
      .prepare(
        `SELECT price_per_m2 FROM listings
         WHERE is_active = 1 AND district = ? AND price_per_m2 IS NOT NULL`,
      )
      .all(district) as Array<{ price_per_m2: number }>;
    return median(live.map((r) => r.price_per_m2));
  }

  function hasAlertBeenSent(listingId: string, type: string): boolean {
    return !!db
      .prepare('SELECT 1 FROM alerts_sent WHERE listing_id = ? AND type = ?')
      .get(String(listingId), type);
  }

  function recordAlertSent(listingId: string, type: string): void {
    db.prepare(
      'INSERT OR IGNORE INTO alerts_sent (listing_id, type, sent_at) VALUES (?, ?, ?)',
    ).run(String(listingId), type, clock());
  }

  function getListingsForMap(): Array<Partial<ListingRow>> {
    return db
      .prepare(
        `SELECT id, title, url, district, rooms, area_m2, price, price_per_m2, lat, lng
         FROM listings WHERE is_active = 1 AND lat IS NOT NULL AND lng IS NOT NULL`,
      )
      .all() as Array<Partial<ListingRow>>;
  }

  function countActive(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM listings WHERE is_active = 1').get() as {
      n: number;
    }).n;
  }

  function countListings(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n;
  }

  function countPendingVerification(): number {
    return (
      db.prepare('SELECT COUNT(*) AS n FROM listings WHERE is_active = 1 AND miss_count > 0').get() as {
        n: number;
      }
    ).n;
  }

  function getPendingVerificationListings(): ListingRow[] {
    return db
      .prepare(
        `SELECT * FROM listings
         WHERE is_active = 1 AND miss_count > 0
         ORDER BY miss_count DESC, district ASC, price ASC`,
      )
      .all() as ListingRow[];
  }

  function getVerifiedRemovedListings(): ListingRow[] {
    return db
      .prepare(
        `SELECT * FROM listings
         WHERE is_active = 0 AND miss_count >= verification_miss_threshold
         ORDER BY last_seen_at DESC`,
      )
      .all() as ListingRow[];
  }

  function countVerifiedRemoved(): number {
    return (
      db.prepare(
        `SELECT COUNT(*) AS n FROM listings
         WHERE is_active = 0 AND miss_count >= verification_miss_threshold`,
      ).get() as { n: number }
    ).n;
  }

  function close(): void {
    db.close();
  }

  return {
    db,
    round2,
    upsertListing,
    upsertMany,
    deactivateNotSeenSince,
    incrementMissCountForNotSeenSince,
    getListingsForVerification,
    resetMissCount,
    deactivateListing,
    getActiveListings,
    getListingById,
    getNewListingsSince,
    computeCurrentDistrictStats,
    computePeriodDistrictStats,
    upsertDailyStats,
    snapshotDailyStats,
    getDistrictStatsHistory,
    getDistrictBaseline,
    hasAlertBeenSent,
    recordAlertSent,
    getListingsForMap,
    countActive,
    countListings,
    countPendingVerification,
    getPendingVerificationListings,
    getVerifiedRemovedListings,
    countVerifiedRemoved,
    close,
  };
}

export type Repository = ReturnType<typeof createRepository>;

export function openDatabase(
  dbPath = 'data/listings.db',
  opts: RepositoryOptions = {},
): Repository {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return createRepository(db, opts);
}
