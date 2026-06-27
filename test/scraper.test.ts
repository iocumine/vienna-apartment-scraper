import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSearchUrl,
  parseEuroNumber,
  attrMap,
  normalizeAdvert,
  extractAdvertSummaries,
  extractNextData,
  filterListings,
  fetchPage,
  scrape,
  BASE_URL,
  type Advert,
} from '../src/scraper/willhaben.js';
import {
  getWillhabenAccessStatus,
  recordWillhabenForbidden,
  resetWillhabenAccessStatus,
} from '../src/lib/willhabenStatus.js';
import type { AppConfig } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'willhaben-search.json'), 'utf8'),
);
const adverts: Advert[] =
  fixture.props.pageProps.searchResult.advertSummaryList.advertSummary;

describe('buildSearchUrl', () => {
  it('builds a Vienna rent search URL with paging', () => {
    const url = buildSearchUrl({ transactionType: 'rent', page: 2, roomsMin: 1, roomsMax: 2 });
    expect(url).toContain('/iad/immobilien/mietwohnungen/mietwohnung-angebote');
    expect(url).toContain('areaId=900');
    expect(url).toContain('page=2');
    expect(url).toContain('NO_OF_ROOMS_BUCKET_FROM=1');
    expect(url).toContain('NO_OF_ROOMS_BUCKET_TO=2');
  });

  it('supports district areaId and keyword lookup', () => {
    const url = buildSearchUrl({ areaId: 1070, keyword: '1100144463' });
    expect(url).toContain('areaId=1070');
    expect(url).toContain('keyword=1100144463');
  });

  it('uses the buy path for purchases', () => {
    expect(buildSearchUrl({ transactionType: 'buy' })).toContain('eigentumswohnung');
  });
});

describe('parseEuroNumber', () => {
  it('parses plain integers', () => {
    expect(parseEuroNumber('950')).toBe(950);
  });
  it('parses EU decimals', () => {
    expect(parseEuroNumber('1.250,50')).toBe(1250.5);
  });
  it('parses US decimals', () => {
    expect(parseEuroNumber('1234.56')).toBe(1234.56);
  });
  it('strips currency symbols and no-cents suffix', () => {
    expect(parseEuroNumber('EUR 1.000,-')).toBe(1000);
  });
  it('passes through numbers and rejects junk', () => {
    expect(parseEuroNumber(42)).toBe(42);
    expect(parseEuroNumber('abc')).toBeNull();
    expect(parseEuroNumber(null)).toBeNull();
  });
});

describe('attrMap', () => {
  it('maps attribute names to value arrays', () => {
    const m = attrMap(adverts[0]);
    expect(m.PRICE).toEqual(['950']);
    expect(m.POSTCODE).toEqual(['1070']);
  });
  it('returns empty map for missing attributes', () => {
    expect(attrMap({})).toEqual({});
    expect(attrMap(null)).toEqual({});
  });
});

describe('normalizeAdvert', () => {
  it('normalizes a full advert', () => {
    const n = normalizeAdvert(adverts[0])!;
    expect(n).toMatchObject({
      id: '1001',
      title: 'Helle 2-Zimmer Wohnung im 7. Bezirk',
      price: 950,
      area_m2: 50,
      rooms: 2,
      postcode: 1070,
      district: 7,
      price_per_m2: 19,
      lat: 48.201,
      lng: 16.345,
    });
    expect(n.url).toBe(
      `${BASE_URL}/iad/immobilien/d/mietwohnungen/wien/wien-1070-neubau/helle-wohnung-1001/`,
    );
    expect(n.published_at).toBe(new Date(1717228800000).toISOString());
  });

  it('derives district from postcode', () => {
    expect(normalizeAdvert(adverts[1])!.district).toBe(9);
    expect(normalizeAdvert(adverts[3])!.district).toBe(2);
  });

  it('returns null for adverts without an id', () => {
    expect(normalizeAdvert({})).toBeNull();
    expect(normalizeAdvert(null)).toBeNull();
  });

  it('falls back to a constructed url when SEO_URL is missing', () => {
    const n = normalizeAdvert({ id: '77', attributes: { attribute: [] } })!;
    expect(n.url).toBe(`${BASE_URL}/iad/immobilien/d/77`);
  });
});

describe('extractAdvertSummaries', () => {
  it('finds adverts in the __NEXT_DATA__ shape', () => {
    expect(extractAdvertSummaries(fixture)).toHaveLength(4);
  });
  it('accepts a plain array', () => {
    expect(extractAdvertSummaries([{ id: 1 }])).toHaveLength(1);
  });
  it('accepts the bare search result shape', () => {
    const shape = { advertSummaryList: { advertSummary: [{ id: 1 }, { id: 2 }] } };
    expect(extractAdvertSummaries(shape)).toHaveLength(2);
  });
  it('returns empty array for unknown shapes', () => {
    expect(extractAdvertSummaries(null)).toEqual([]);
    expect(extractAdvertSummaries({ foo: 'bar' })).toEqual([]);
  });
});

describe('extractNextData', () => {
  it('extracts and parses embedded JSON', () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script></body></html>`;
    const data = extractNextData(html);
    expect(extractAdvertSummaries(data)).toHaveLength(4);
  });
  it('returns null when the script is missing or malformed', () => {
    expect(extractNextData('<html></html>')).toBeNull();
    expect(extractNextData('<script id="__NEXT_DATA__">{bad json</script>')).toBeNull();
    expect(extractNextData(null)).toBeNull();
  });
});

describe('filterListings', () => {
  const all = extractAdvertSummaries(fixture).map(normalizeAdvert);

  it('keeps only wanted districts and room counts', () => {
    const filtered = filterListings(all, { districts: [2, 7, 9], roomsMin: 1, roomsMax: 2 });
    expect(filtered.map((l) => l.id).sort()).toEqual(['1001', '1002', '1004']);
  });

  it('drops out-of-range rooms', () => {
    const filtered = filterListings(all, { districts: [22], roomsMin: 1, roomsMax: 2 });
    expect(filtered).toHaveLength(0);
  });

  it('drops listings missing price or area', () => {
    const broken = [
      { id: 'x', district: 7, rooms: 2, price: null, area_m2: 50 } as never,
    ];
    expect(filterListings(broken, { districts: [7] })).toHaveLength(0);
  });
});

describe('fetchPage', () => {
  beforeEach(() => resetWillhabenAccessStatus());

  it('fetches HTML and returns normalized listings', async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script>`;
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
    const listings = await fetchPage('http://x', { fetchImpl });
    expect(listings).toHaveLength(4);
    expect(listings[0]!.id).toBe('1001');
  });

  it('throws on non-ok responses', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => '',
    });
    await expect(fetchPage('http://x', { fetchImpl })).rejects.toThrow(/403/);
  });

  it('records willhaben access as forbidden on HTTP 403', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => '',
    });
    await expect(fetchPage('http://x', { fetchImpl })).rejects.toThrow(/403/);
    expect(getWillhabenAccessStatus().forbidden).toBe(true);
  });

  it('clears forbidden state after a successful fetch', async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script>`;
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
    recordWillhabenForbidden('blocked');
    await fetchPage('http://x', { fetchImpl });
    expect(getWillhabenAccessStatus().forbidden).toBe(false);
  });

  it('does not mark access forbidden for other HTTP errors', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 500,
      statusText: 'Error',
      text: async () => '',
    });
    await expect(fetchPage('http://x', { fetchImpl })).rejects.toThrow(/500/);
    expect(getWillhabenAccessStatus().forbidden).toBe(false);
  });

  it('acquires from the rate limiter before fetching', async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script>`;
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
    const acquire = vi.fn(async () => {});
    await fetchPage('http://x', { fetchImpl, rateLimiter: { acquire } });
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});

describe('scrape', () => {
  const cfg = {
    transactionType: 'rent',
    districts: [2, 7, 9],
    roomsMin: 1,
    roomsMax: 2,
    maxPagesPerDistrict: 3,
    requestDelayMs: 0,
  } as AppConfig;

  it('paginates, dedupes, and filters', async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script>`;
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const body = calls === 1 ? html : '<html></html>';
      return { ok: true, status: 200, text: async () => body };
    };
    const result = await scrape(cfg, { fetchImpl, sleep: async () => {} });
    expect(result.map((l) => l.id).sort()).toEqual(['1001', '1002', '1004']);
    expect(calls).toBe(4);
  });

  it('stops gracefully when a page fails', async () => {
    const fetchImpl = async () => {
      throw new Error('network down');
    };
    const result = await scrape(cfg, { fetchImpl, sleep: async () => {}, logger: { warn() {} } });
    expect(result).toEqual([]);
  });
});
