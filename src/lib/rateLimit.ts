export interface RateLimiter {
  acquire(): Promise<void>;
}

export interface RateLimiterDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sliding-window limiter: at most maxPerMinute requests in any 60s window.
export function createRateLimiter(
  maxPerMinute: number,
  { now = () => Date.now(), sleep = defaultSleep }: RateLimiterDeps = {},
): RateLimiter {
  const limit = Math.max(1, Math.floor(maxPerMinute));
  const windowMs = 60_000;
  const timestamps: number[] = [];

  function prune(current: number): void {
    while (timestamps.length > 0 && timestamps[0]! <= current - windowMs) {
      timestamps.shift();
    }
  }

  return {
    async acquire(): Promise<void> {
      while (true) {
        const current = now();
        prune(current);
        if (timestamps.length < limit) {
          timestamps.push(current);
          return;
        }
        const waitMs = timestamps[0]! + windowMs - current + 1;
        await sleep(Math.max(1, waitMs));
      }
    },
  };
}
