import { districtForPostcode, postcodeForDistrict } from '../config.js';
import type { RateLimiter } from '../lib/rateLimit.js';
import {
  recordWillhabenForbidden,
  recordWillhabenSuccess,
} from '../lib/willhabenStatus.js';
import { pricePerM2 } from '../lib/metrics.js';
import type { AppConfig, Logger, NormalizedListing, TransactionType } from '../types.js';

export const BASE_URL = 'https://www.willhaben.at';

const SEARCH_PATHS: Record<TransactionType, string> = {
  rent: '/iad/immobilien/mietwohnungen/mietwohnung-angebote',
  buy: '/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote',
};

// Vienna-wide area id on willhaben. We fetch the whole city and filter by
// district in code, which is far more robust than guessing per-district ids.
const VIENNA_AREA_ID = 900;

export interface SearchUrlParams {
  transactionType?: TransactionType;
  page?: number;
  rows?: number;
  roomsMin?: number;
  roomsMax?: number;
  areaId?: number;
  keyword?: string;
}

export function buildSearchUrl({
  transactionType = 'rent',
  page = 1,
  rows = 90,
  roomsMin,
  roomsMax,
  areaId = VIENNA_AREA_ID,
  keyword,
}: SearchUrlParams = {}): string {
  const path = SEARCH_PATHS[transactionType] ?? SEARCH_PATHS.rent;
  const params = new URLSearchParams();
  params.set('areaId', String(areaId));
  params.set('rows', String(rows));
  params.set('page', String(page));
  params.set('sort', '1'); // newest first
  if (Number.isFinite(roomsMin)) params.set('NO_OF_ROOMS_BUCKET_FROM', String(roomsMin));
  if (Number.isFinite(roomsMax)) params.set('NO_OF_ROOMS_BUCKET_TO', String(roomsMax));
  if (keyword) params.set('keyword', keyword);
  return `${BASE_URL}${path}?${params.toString()}`;
}

export function buildKeywordSearchUrl(
  id: string,
  transactionType: TransactionType = 'rent',
): string {
  return buildSearchUrl({ transactionType, keyword: String(id), rows: 30, page: 1 });
}

// willhaben stores numbers in mixed formats: "1.234,56" (EU), "1234.56", "50".
export function parseEuroNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).replace(/[^0-9,.-]/g, '');
  if (s === '') return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Last separator is the decimal point.
    s =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  // Drop trailing separators left by formats like "1.000,-".
  s = s.replace(/[-.,]+$/, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface Attribute {
  name?: string;
  values?: unknown[] | unknown;
}

export interface Advert {
  id?: string | number;
  description?: string;
  attributes?: { attribute?: Attribute[] };
  [key: string]: unknown;
}

// Turn an advert's attribute list into { NAME: [values] }.
export function attrMap(advert: Advert | null | undefined): Record<string, unknown[]> {
  const list = advert?.attributes?.attribute ?? [];
  const map: Record<string, unknown[]> = {};
  for (const a of list) {
    if (!a || !a.name) continue;
    map[a.name] = Array.isArray(a.values) ? a.values : [a.values];
  }
  return map;
}

function firstAttr(map: Record<string, unknown[]>, ...names: string[]): unknown {
  for (const name of names) {
    const vals = map[name];
    if (vals && vals.length > 0 && vals[0] !== undefined && vals[0] !== null) {
      return vals[0];
    }
  }
  return null;
}

function parseCoordinates(raw: unknown): { lat: number | null; lng: number | null } {
  if (!raw) return { lat: null, lng: null };
  const [latStr, lngStr] = String(raw).split(/[,;]/);
  const lat = Number(latStr);
  const lng = Number(lngStr);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function toIso(epochLike: unknown): string | null {
  if (!epochLike) return null;
  const n = Number(epochLike);
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString();
  const d = new Date(epochLike as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeAdvert(advert: Advert | null | undefined): NormalizedListing | null {
  if (!advert || advert.id === undefined || advert.id === null) return null;
  const map = attrMap(advert);
  const price = parseEuroNumber(firstAttr(map, 'PRICE', 'PRICE_FOR_DISPLAY'));
  const area = parseEuroNumber(
    firstAttr(map, 'ESTATE_SIZE/LIVING_AREA', 'ESTATE_SIZE', 'LIVING_AREA'),
  );
  const rooms = parseEuroNumber(firstAttr(map, 'NUMBER_OF_ROOMS', 'NO_OF_ROOMS'));
  const postcode = parseEuroNumber(firstAttr(map, 'POSTCODE'));
  const { lat, lng } = parseCoordinates(firstAttr(map, 'COORDINATES'));
  const seoUrl = firstAttr(map, 'SEO_URL');
  const url = seoUrl
    ? String(seoUrl).startsWith('http')
      ? String(seoUrl)
      : `${BASE_URL}/iad/${seoUrl}`
    : `${BASE_URL}/iad/immobilien/d/${advert.id}`;

  return {
    id: String(advert.id),
    title: advert.description ?? (firstAttr(map, 'HEADING') as string | null) ?? null,
    url,
    price,
    area_m2: area,
    rooms,
    postcode: postcode ?? null,
    district: districtForPostcode(postcode),
    lat,
    lng,
    price_per_m2: pricePerM2(price, area),
    published_at: toIso(firstAttr(map, 'PUBLISHED', 'PUBLISHED_String')),
    raw: advert,
  };
}

type NextDataLike = {
  props?: { pageProps?: { searchResult?: SearchResultLike } };
  searchResult?: SearchResultLike;
  advertSummaryList?: { advertSummary?: Advert[] };
  advertSummary?: Advert[];
};

type SearchResultLike = { advertSummaryList?: { advertSummary?: Advert[] } };

// Find the advert summary array regardless of which response shape we got.
export function extractAdvertSummaries(data: unknown): Advert[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as Advert[];
  const d = data as NextDataLike;
  const candidates = [
    d?.props?.pageProps?.searchResult?.advertSummaryList?.advertSummary,
    d?.searchResult?.advertSummaryList?.advertSummary,
    d?.advertSummaryList?.advertSummary,
    d?.advertSummary,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

export function extractNextData(html: string | null | undefined): unknown {
  if (!html) return null;
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return null;
  }
}

export interface FilterOptions {
  districts?: number[];
  roomsMin?: number;
  roomsMax?: number;
}

export function filterListings(
  listings: Array<NormalizedListing | null>,
  { districts, roomsMin, roomsMax }: FilterOptions = {},
): NormalizedListing[] {
  const districtSet = districts ? new Set(districts.map(Number)) : null;
  return listings.filter((l): l is NormalizedListing => {
    if (!l) return false;
    if (districtSet && !districtSet.has(Number(l.district))) return false;
    if (Number.isFinite(roomsMin) && l.rooms !== null && l.rooms < roomsMin!) return false;
    if (Number.isFinite(roomsMax) && l.rooms !== null && l.rooms > roomsMax!) return false;
    if (l.price === null || !Number.isFinite(l.price)) return false;
    if (l.area_m2 === null || !Number.isFinite(l.area_m2)) return false;
    return true;
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchLike = (url: string, init?: unknown) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  text: () => Promise<string>;
}>;

export interface ScrapeDeps {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  rateLimiter?: RateLimiter;
  logger?: Logger;
}

// Fetch + parse a single search page into normalized (unfiltered) listings.
export async function fetchPage(
  url: string,
  {
    fetchImpl = fetch as unknown as FetchLike,
    rateLimiter,
  }: { fetchImpl?: FetchLike; rateLimiter?: RateLimiter } = {},
): Promise<NormalizedListing[]> {
  await rateLimiter?.acquire();
  const res = await fetchImpl(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/json',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) {
    const message = `willhaben request failed: ${res.status} ${res.statusText ?? ''}`.trim();
    if (res.status === 403) recordWillhabenForbidden(message);
    throw new Error(message);
  }
  recordWillhabenSuccess();
  const body = await res.text();
  const data = extractNextData(body) ?? safeJson(body);
  const adverts = extractAdvertSummaries(data);
  return adverts.map(normalizeAdvert).filter((l): l is NormalizedListing => l !== null);
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// Scrape each configured district (by postcode areaId) across pages, dedupe, and filter.
export async function scrape(
  config: AppConfig,
  deps: ScrapeDeps = {},
): Promise<NormalizedListing[]> {
  const {
    fetchImpl = fetch as unknown as FetchLike,
    sleep = defaultSleep,
    logger = console,
  } = deps;
  const maxPages = config.maxPagesPerDistrict ?? 5;
  const seen = new Map<string, NormalizedListing>();
  for (const district of config.districts) {
    const areaId = postcodeForDistrict(district);
    if (areaId === null) {
      logger.warn?.(`scrape: unknown district ${district}, skipping`);
      continue;
    }
    for (let page = 1; page <= maxPages; page += 1) {
      const url = buildSearchUrl({
        transactionType: config.transactionType,
        areaId,
        page,
        roomsMin: config.roomsMin,
        roomsMax: config.roomsMax,
      });
      let pageListings: NormalizedListing[];
      try {
        pageListings = await fetchPage(url, { fetchImpl, rateLimiter: deps.rateLimiter });
      } catch (err) {
        logger.warn?.(`scrape district ${district} page ${page} failed: ${(err as Error).message}`);
        break;
      }
      if (pageListings.length === 0) break;
      for (const l of pageListings) seen.set(l.id, l);
      if (page < maxPages) await sleep(config.requestDelayMs ?? 1500);
    }
  }
  return filterListings([...seen.values()], {
    districts: config.districts,
    roomsMin: config.roomsMin,
    roomsMax: config.roomsMax,
  });
}
