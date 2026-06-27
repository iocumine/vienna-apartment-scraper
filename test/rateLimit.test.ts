import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRateLimiter, countWillhabenRequestsLast60s, countWillhabenRequestsSinceStartup, getWillhabenRequestStatsSinceStartup, getWillhabenRequestsLast60s, recordWillhabenRequest, resetWillhabenRequestTracking } from '../src/lib/rateLimit.js';

describe('createRateLimiter', () => {
  it('allows up to maxPerMinute requests without waiting', async () => {
    let now = 0;
    const sleep = vi.fn(async () => {});
    const limiter = createRateLimiter(3, { now: () => now, sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits until the oldest request falls out of the 60s window', async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const limiter = createRateLimiter(2, { now: () => now, sleep });

    await limiter.acquire(); // t=0
    now = 1_000;
    await limiter.acquire(); // t=1000
    now = 2_000;
    await limiter.acquire(); // should wait until first slot expires at 60_000

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![0]).toBe(58_001);
  });

  it('floors invalid limits to at least 1 per minute', async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const limiter = createRateLimiter(0, { now: () => now, sleep });

    await limiter.acquire();
    now = 1;
    await limiter.acquire();

    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('reports when the next request would have to wait', async () => {
    let now = 0;
    const limiter = createRateLimiter(2, { now: () => now, sleep: async () => {} });
    expect(limiter.wouldBlock()).toBe(false);
    await limiter.acquire();
    expect(limiter.wouldBlock()).toBe(false);
    await limiter.acquire();
    expect(limiter.wouldBlock()).toBe(true);
  });
});

describe('willhaben request tracking', () => {
  beforeEach(() => resetWillhabenRequestTracking());

  it('counts requests in the rolling last 60 seconds', () => {
    const now = 1_000_000;
    recordWillhabenRequest(now - 61_000);
    recordWillhabenRequest(now - 30_000);
    recordWillhabenRequest(now - 10_000);
    expect(countWillhabenRequestsLast60s(now)).toBe(2);
  });

  it('returns recent request details newest first', () => {
    const now = 1_000_000;
    recordWillhabenRequest({ at: now - 30_000, url: 'https://www.willhaben.at/a', status: 200, ok: true });
    recordWillhabenRequest({ at: now - 10_000, url: 'https://www.willhaben.at/b', status: 403, ok: false });
    recordWillhabenRequest(now - 61_000, 'https://www.willhaben.at/old');
    expect(getWillhabenRequestsLast60s(now)).toEqual([
      { at: now - 10_000, url: 'https://www.willhaben.at/b', status: 403, ok: false },
      { at: now - 30_000, url: 'https://www.willhaben.at/a', status: 200, ok: true },
    ]);
  });

  it('counts all requests since process startup regardless of age', () => {
    const now = 1_000_000;
    recordWillhabenRequest(now - 61_000);
    recordWillhabenRequest(now - 30_000);
    recordWillhabenRequest(now - 10_000);
    expect(countWillhabenRequestsSinceStartup()).toBe(3);
    expect(countWillhabenRequestsLast60s(now)).toBe(2);
    resetWillhabenRequestTracking();
    expect(countWillhabenRequestsSinceStartup()).toBe(0);
  });

  it('computes uptime and average req/min since startup', () => {
    const startedAt = 1_000_000;
    resetWillhabenRequestTracking(startedAt);
    recordWillhabenRequest(startedAt + 10_000);
    recordWillhabenRequest(startedAt + 20_000);
    recordWillhabenRequest(startedAt + 30_000);
    const now = startedAt + 120_000; // 2 minutes uptime
    expect(getWillhabenRequestStatsSinceStartup(now)).toEqual({
      total: 3,
      uptimeMs: 120_000,
      avgPerMinute: 1.5,
    });
    expect(getWillhabenRequestStatsSinceStartup(startedAt)).toEqual({
      total: 3,
      uptimeMs: 0,
      avgPerMinute: 0,
    });
  });
});
