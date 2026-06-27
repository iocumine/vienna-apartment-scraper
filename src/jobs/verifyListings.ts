import { buildKeywordSearchUrl, fetchPage, type ScrapeDeps } from '../scraper/willhaben.js';
import type { Repository } from '../db/index.js';
import {
  clearVerificationDeferred,
  recordVerificationDeferred,
} from '../lib/willhabenStatus.js';
import type { AppConfig, Logger, TransactionType } from '../types.js';
import { VERIFICATION_MIN_HOURS } from '../types.js';

export interface VerifyListingsDeps extends ScrapeDeps {
  verifyListingFn?: (id: string, transactionType: TransactionType, deps: ScrapeDeps) => Promise<boolean>;
}

export interface VerifyListingsOptions {
  repo: Repository;
  config: AppConfig;
  deps?: VerifyListingsDeps;
  now?: () => string;
  logger?: Logger;
}

export interface VerifyListingsResult {
  checked: number;
  deactivated: number;
  reconfirmed: number;
  deferred: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isListingActiveOnWillhaben(
  id: string,
  transactionType: TransactionType,
  deps: ScrapeDeps = {},
): Promise<boolean> {
  const url = buildKeywordSearchUrl(id, transactionType);
  const listings = await fetchPage(url, {
    fetchImpl: deps.fetchImpl,
    rateLimiter: deps.rateLimiter,
  });
  return listings.some((l) => l.id === String(id));
}

// Check active listings that missed enough polls and have been unseen long enough.
export async function verifyStaleListings({
  repo,
  config,
  deps = {},
  now = () => new Date().toISOString(),
  logger = console,
}: VerifyListingsOptions): Promise<VerifyListingsResult> {
  const nowIso = now();
  const maxLastSeenAt = new Date(
    new Date(nowIso).getTime() - VERIFICATION_MIN_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const candidates = repo.getListingsForVerification(maxLastSeenAt);
  clearVerificationDeferred();
  const verifyFn =
    deps.verifyListingFn ??
    ((id, tx, scrapeDeps) => isListingActiveOnWillhaben(id, tx, scrapeDeps));
  const sleep = deps.sleep ?? defaultSleep;
  const delayMs = config.requestDelayMs ?? 1500;
  const rateLimit = config.willhabenRequestsPerMinute ?? 25;

  let deactivated = 0;
  let reconfirmed = 0;
  let checked = 0;
  let deferred = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    if (deps.rateLimiter?.wouldBlock?.()) {
      deferred = candidates.length - i;
      recordVerificationDeferred(deferred, rateLimit, nowIso);
      logger.warn?.(
        `verify: rate limit (${rateLimit}/min) reached, deferred ${deferred} pending verifications`,
      );
      break;
    }
    const row = candidates[i]!;
    try {
      const stillActive = await verifyFn(row.id, config.transactionType, deps);
      checked += 1;
      if (stillActive) {
        repo.resetMissCount(row.id);
        reconfirmed += 1;
      } else {
        repo.deactivateListing(row.id);
        deactivated += 1;
      }
    } catch (err) {
      checked += 1;
      logger.warn?.(`verify ${row.id} failed: ${(err as Error).message}`);
    }
    if (i < candidates.length - 1) await sleep(delayMs);
  }

  if (checked > 0) {
    logger.info?.(
      `verify: ${checked} checked, ${deactivated} deactivated, ${reconfirmed} reconfirmed${deferred ? `, ${deferred} deferred` : ''}`,
    );
  }
  return { checked, deactivated, reconfirmed, deferred };
}
