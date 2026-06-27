import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRateLimiter, countWillhabenRequestsLast60s, recordWillhabenRequest, resetWillhabenRequestTracking } from '../src/lib/rateLimit.js';

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
});
