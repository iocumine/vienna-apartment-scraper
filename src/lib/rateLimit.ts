export interface RateLimiter {
  acquire(): Promise<void>;
  /** True when another request would have to wait for the 60s window to slide. */
  wouldBlock(): boolean;
}

export interface WillhabenRequestLogEntry {
  at: number;
  url: string;
  status: number | null;
  ok: boolean;
}

const REQUEST_WINDOW_MS = 60_000;
const globalRequestLog: WillhabenRequestLogEntry[] = [];
let totalRequestCountSinceStartup = 0;
let processStartedAt = Date.now();

export interface WillhabenRequestStatsSinceStartup {
  total: number;
  uptimeMs: number;
  avgPerMinute: number;
}

function pruneRequestLog(current: number): void {
  const cutoff = current - REQUEST_WINDOW_MS;
  let write = 0;
  for (let read = 0; read < globalRequestLog.length; read += 1) {
    const entry = globalRequestLog[read]!;
    if (entry.at > cutoff) {
      globalRequestLog[write] = entry;
      write += 1;
    }
  }
  globalRequestLog.length = write;
}

function normalizeRequestEntry(
  atOrEntry: number | Partial<WillhabenRequestLogEntry>,
  legacyUrl?: string,
): WillhabenRequestLogEntry {
  if (typeof atOrEntry === 'number') {
    return { at: atOrEntry, url: legacyUrl ?? '', status: null, ok: false };
  }
  return {
    at: atOrEntry.at ?? Date.now(),
    url: atOrEntry.url ?? '',
    status: atOrEntry.status ?? null,
    ok: atOrEntry.ok ?? false,
  };
}

export function recordWillhabenRequest(
  atOrEntry: number | Partial<WillhabenRequestLogEntry> = Date.now(),
  legacyUrl?: string,
): void {
  const entry = normalizeRequestEntry(atOrEntry, legacyUrl);
  globalRequestLog.push(entry);
  totalRequestCountSinceStartup += 1;
  pruneRequestLog(entry.at);
}

export function countWillhabenRequestsLast60s(now: number = Date.now()): number {
  pruneRequestLog(now);
  return globalRequestLog.length;
}

export function countWillhabenRequestsSinceStartup(): number {
  return totalRequestCountSinceStartup;
}

export function getWillhabenRequestStatsSinceStartup(
  now: number = Date.now(),
): WillhabenRequestStatsSinceStartup {
  const total = totalRequestCountSinceStartup;
  const uptimeMs = Math.max(0, now - processStartedAt);
  const avgPerMinute = uptimeMs > 0 ? total / (uptimeMs / 60_000) : 0;
  return { total, uptimeMs, avgPerMinute };
}

export function getWillhabenRequestsLast60s(now: number = Date.now()): WillhabenRequestLogEntry[] {
  pruneRequestLog(now);
  return [...globalRequestLog].reverse();
}

export function resetWillhabenRequestTracking(startedAt: number = Date.now()): void {
  globalRequestLog.length = 0;
  totalRequestCountSinceStartup = 0;
  processStartedAt = startedAt;
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
