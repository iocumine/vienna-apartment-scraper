import type { AppConfig, TransactionType } from './types.js';

// District -> Vienna postal code (Bezirk N => 1N0).
export const DISTRICT_POSTCODES: Record<number, number> = {
  1: 1010,
  2: 1020,
  3: 1030,
  4: 1040,
  5: 1050,
  6: 1060,
  7: 1070,
  8: 1080,
  9: 1090,
  10: 1100,
  11: 1110,
  12: 1120,
  13: 1130,
  14: 1140,
  15: 1150,
  16: 1160,
  17: 1170,
  18: 1180,
  19: 1190,
  20: 1200,
  21: 1210,
  22: 1220,
  23: 1230,
};

export const DEFAULT_DISTRICTS: number[] = [2, 3, 6, 7, 8, 9, 17, 18, 19];

export function postcodeForDistrict(district: number | string): number | null {
  return DISTRICT_POSTCODES[Number(district)] ?? null;
}

export function districtForPostcode(postcode: number | string | null | undefined): number | null {
  const pc = Number(postcode);
  if (!Number.isInteger(pc) || pc < 1010 || pc > 1239) return null;
  // Vienna postcodes are 1<DD>0; the district is the middle two digits.
  return Math.floor((pc % 1000) / 10);
}

export function parseDistricts(
  raw: string | undefined | null,
  fallback: number[] = DEFAULT_DISTRICTS,
): number[] {
  if (raw === undefined || raw === null || String(raw).trim() === '') return [...fallback];
  const parsed = String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && DISTRICT_POSTCODES[n] !== undefined);
  return parsed.length > 0 ? parsed : [...fallback];
}

type Env = Record<string, string | undefined>;

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: string | undefined, fallback: string): string {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value);
}

// Parse a comma- (or semicolon-) separated list of email addresses into a
// deduped array, falling back when nothing usable is provided.
export function parseEmails(value: string | undefined | null, fallback: string[] = []): string[] {
  if (value === undefined || value === null || String(value).trim() === '') return [...fallback];
  const parsed = String(value)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const deduped = [...new Set(parsed)];
  return deduped.length > 0 ? deduped : [...fallback];
}

export function loadConfig(env: Env = process.env): AppConfig {
  const transactionType: TransactionType =
    str(env.TRANSACTION_TYPE, 'rent').toLowerCase() === 'buy' ? 'buy' : 'rent';
  return {
    transactionType,
    districts: parseDistricts(env.DISTRICTS),
    roomsMin: num(env.ROOMS_MIN, 1),
    roomsMax: num(env.ROOMS_MAX, 2),

    pollCron: str(env.POLL_INTERVAL_CRON, '*/45 * * * *'),
    statsCron: str(env.STATS_CRON, '5 0 * * *'),
    dailyReportCron: str(env.DAILY_REPORT_CRON, '0 8 * * *'),

    alertThresholdPct: num(env.ALERT_THRESHOLD_PCT, 0.15),
    statsWindowDays: num(env.STATS_WINDOW_DAYS, 30),

    dbPath: str(env.DB_PATH, 'data/listings.db'),
    port: num(env.PORT, 3000),
    timezone: str(env.TZ, 'Europe/Vienna'),

    smtp: {
      host: str(env.SMTP_HOST, 'smtp.gmail.com'),
      port: num(env.SMTP_PORT, 465),
      secure: str(env.SMTP_SECURE, 'true') !== 'false',
      user: str(env.SMTP_USER, ''),
      pass: str(env.SMTP_PASS, ''),
      from: str(env.SMTP_FROM, env.SMTP_USER || ''),
    },
    alertEmailTo: parseEmails(env.ALERT_EMAIL_TO, env.SMTP_USER ? [env.SMTP_USER] : []),
    reportEmailTo: parseEmails(env.REPORT_EMAIL_TO, env.SMTP_USER ? [env.SMTP_USER] : []),

    requestDelayMs: num(env.REQUEST_DELAY_MS, 1500),
    maxPagesPerDistrict: num(env.MAX_PAGES_PER_DISTRICT, 5),
  };
}
