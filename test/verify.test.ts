import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createRepository, type Repository } from '../src/db/index.js';
import {
  isListingActiveOnWillhaben,
  verifyStaleListings,
} from '../src/jobs/verifyListings.js';
import type { AppConfig } from '../src/types.js';

function repoWithClock(clockRef: { now: string }): Repository {
  return createRepository(new Database(':memory:'), { clock: () => clockRef.now });
}

const baseConfig = {
  transactionType: 'rent',
  verificationMissThreshold: 5,
  requestDelayMs: 0,
} as AppConfig;

describe('isListingActiveOnWillhaben', () => {
  it('returns true when keyword search finds the exact listing id', async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          searchResult: {
            advertSummaryList: {
              advertSummary: [{ id: '42', description: 'Flat', attributes: { attribute: [] } }],
            },
          },
        },
      },
    })}</script>`;
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
    expect(await isListingActiveOnWillhaben('42', 'rent', { fetchImpl })).toBe(true);
  });

  it('returns false when the id is not in search results', async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { searchResult: { advertSummaryList: { advertSummary: [] } } } },
    })}</script>`;
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
    expect(await isListingActiveOnWillhaben('42', 'rent', { fetchImpl })).toBe(false);
  });
});

describe('verifyStaleListings', () => {
  it('deactivates listings verified inactive and reconfirms active ones', async () => {
    const clock = { now: '2026-06-10T12:00:00.000Z' };
    const repo = repoWithClock(clock);
    repo.upsertListing({
      id: 'gone',
      title: 'Gone',
      url: 'https://willhaben.at/gone',
      district: 7,
      postcode: 1070,
      rooms: 2,
      area_m2: 50,
      price: 1000,
      price_per_m2: 20,
      lat: null,
      lng: null,
      published_at: null,
    });
    repo.upsertListing({
      id: 'still',
      title: 'Still',
      url: 'https://willhaben.at/still',
      district: 7,
      postcode: 1070,
      rooms: 2,
      area_m2: 50,
      price: 1000,
      price_per_m2: 20,
      lat: null,
      lng: null,
      published_at: null,
    });
    // Last seen more than 12h ago with enough misses.
    repo.db
      .prepare(
        `UPDATE listings SET last_seen_at = ?, miss_count = 5
         WHERE id IN ('gone', 'still')`,
      )
      .run('2026-06-09T12:00:00.000Z');

    const verifyListingFn = vi.fn(async (id: string) => id === 'still');
    const res = await verifyStaleListings({
      repo,
      config: baseConfig,
      deps: { verifyListingFn, sleep: async () => {} },
      now: () => clock.now,
      logger: { info() {}, warn() {} },
    });

    expect(res).toEqual({ checked: 2, deactivated: 1, reconfirmed: 1 });
    expect(repo.getListingById('gone')!.is_active).toBe(0);
    expect(repo.getListingById('still')!.is_active).toBe(1);
    expect(repo.getListingById('still')!.miss_count).toBe(0);
  });

  it('skips listings below the miss threshold or seen within 12 hours', async () => {
    const clock = { now: '2026-06-10T12:00:00.000Z' };
    const repo = repoWithClock(clock);
    repo.upsertListing({
      id: 'recent',
      title: 'Recent',
      url: 'https://willhaben.at/recent',
      district: 7,
      postcode: 1070,
      rooms: 2,
      area_m2: 50,
      price: 1000,
      price_per_m2: 20,
      lat: null,
      lng: null,
      published_at: null,
    });
    repo.db.prepare('UPDATE listings SET miss_count = 5 WHERE id = ?').run('recent');

    const verifyListingFn = vi.fn(async () => false);
    const res = await verifyStaleListings({
      repo,
      config: baseConfig,
      deps: { verifyListingFn, sleep: async () => {} },
      now: () => clock.now,
      logger: { info() {}, warn() {} },
    });

    expect(res.checked).toBe(0);
    expect(verifyListingFn).not.toHaveBeenCalled();
    expect(repo.getListingById('recent')!.is_active).toBe(1);
  });
});
