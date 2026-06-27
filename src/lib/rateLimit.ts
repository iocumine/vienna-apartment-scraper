export interface RateLimiter {
  acquire(): Promise<void>;
  /** True when another request would have to wait for the 60s window to slide. */
  wouldBlock(): boolean;
}

const REQUEST_WINDOW_MS = 60_000;
const globalRequestTimestamps: number[] = [];

function pruneRequestTimestamps(current: number): void {
  while (
    globalRequestTimestamps.length > 0 &&
    globalRequestTimestamps[0]! <= current - REQUEST_WINDOW_MS
  ) {
    globalRequestTimestamps.shift();
  }
}

export function recordWillhabenRequest(at: number = Date.now()): void {
  globalRequestTimestamps.push(at);
  pruneRequestTimestamps(at);
}

export function countWillhabenRequestsLast60s(now: number = Date.now()): number {
  pruneRequestTimestamps(now);
  return globalRequestTimestamps.length;
}

export function resetWillhabenRequestTracking(): void {
  globalRequestTimestamps.length = 0;
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

  function wouldBlock(): boolean {
    const current = now();
    prune(current);
    return timestamps.length >= limit;
  }

  return {
    wouldBlock,
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
