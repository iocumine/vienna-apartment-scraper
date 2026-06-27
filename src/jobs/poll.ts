import { scrape, type ScrapeDeps } from '../scraper/willhaben.js';
import { notifyBelowMarket } from '../alerts/notify.js';
import type { Repository } from '../db/index.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { verifyStaleListings, type VerifyListingsDeps } from './verifyListings.js';
import type { AppConfig, Emailer, Logger, NormalizedListing } from '../types.js';

export interface PollDeps {
  repo: Repository;
  config: AppConfig;
  email?: Emailer | null;
  scrapeFn?: (config: AppConfig, deps?: ScrapeDeps) => Promise<NormalizedListing[]>;
  scrapeDeps?: ScrapeDeps;
  verifyFn?: typeof verifyStaleListings;
  verifyDeps?: VerifyListingsDeps;
  now?: () => string;
  logger?: Logger;
}

export interface PollResult {
  total: number;
  newCount: number;
  alerts: number;
  missed: number;
  verified: number;
  deactivated: number;
}

// One poll cycle: scrape, upsert, track misses, verify stale listings, then alert.
export async function runPoll({
  repo,
  config,
  email = null,
  scrapeFn = scrape,
  scrapeDeps = {},
  verifyFn = verifyStaleListings,
  verifyDeps = {},
  now = () => new Date().toISOString(),
  logger = console,
}: PollDeps): Promise<PollResult> {
  const runStart = now();
  const rateLimiter =
    scrapeDeps.rateLimiter ??
    verifyDeps.rateLimiter ??
    createRateLimiter(config.willhabenRequestsPerMinute);
  const sharedDeps: ScrapeDeps = { ...scrapeDeps, rateLimiter };
  const listings = await scrapeFn(config, sharedDeps);
  logger.info?.(`poll: scraped ${listings.length} listings`);

  const results = repo.upsertMany(listings);
  const newIds = new Set(results.filter((r) => r.isNew).map((r) => r.id));
  const newListings = listings.filter((l) => newIds.has(l.id));
  const missed = repo.incrementMissCountForNotSeenSince(runStart);
  const verification = await verifyFn({
    repo,
    config,
    deps: { ...verifyDeps, rateLimiter },
    now,
    logger,
  });

  const fired = await notifyBelowMarket({
    repo,
    config,
    listings: newListings,
    email,
    logger,
  });

  logger.info?.(
    `poll: ${newListings.length} new, ${missed} missed, ${verification.deactivated} deactivated, ${fired.length} alerts`,
  );
  return {
    total: listings.length,
    newCount: newListings.length,
    alerts: fired.length,
    missed,
    verified: verification.checked,
    deactivated: verification.deactivated,
  };
}
