export type TransactionType = 'rent' | 'buy';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface AppConfig {
  transactionType: TransactionType;
  districts: number[];
  roomsMin: number;
  roomsMax: number;
  pollCron: string;
  statsCron: string;
  dailyReportCron: string;
  alertThresholdPct: number;
  statsWindowDays: number;
  dbPath: string;
  port: number;
  timezone: string;
  smtp: SmtpConfig;
  alertEmailTo: string[];
  reportEmailTo: string[];
  requestDelayMs: number;
  maxPagesPerDistrict: number;
  /** Max willhaben HTTP requests allowed in any rolling 60s window. */
  willhabenRequestsPerMinute: number;
  /** Per-listing miss threshold is chosen randomly in [min, max] when first seen. */
  verificationMissThresholdMin: number;
  verificationMissThresholdMax: number;
}

/** Hours a listing must be unseen before it is eligible for verification. */
export const VERIFICATION_MIN_HOURS = 12;

// A scraped + normalized listing (before persistence).
export interface NormalizedListing {
  id: string;
  title: string | null;
  url: string;
  price: number | null;
  area_m2: number | null;
  rooms: number | null;
  postcode: number | null;
  district: number | null;
  lat: number | null;
  lng: number | null;
  price_per_m2: number | null;
  published_at: string | null;
  raw?: unknown;
  raw_json?: string | null;
}

// A persisted listing row as read back from SQLite.
export interface ListingRow {
  id: string;
  first_seen_at: string;
  last_seen_at: string;
  is_active: number;
  miss_count: number;
  verification_miss_threshold: number;
  title: string | null;
  url: string | null;
  district: number | null;
  postcode: number | null;
  rooms: number | null;
  area_m2: number | null;
  price: number | null;
  price_per_m2: number | null;
  lat: number | null;
  lng: number | null;
  published_at: string | null;
  raw_json: string | null;
}

export interface DistrictStat {
  district: number;
  avg_price_per_m2: number | null;
  median_price_per_m2: number | null;
  active_count: number;
}

export interface DailyStatRow extends DistrictStat {
  date: string;
}

export interface BelowMarketResult {
  triggered: boolean;
  pricePerM2: number | null;
  baseline: number | null;
  deltaPct: number | null;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface Emailer {
  send(message: EmailMessage): Promise<unknown>;
}

export interface Logger {
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}
