import { scrape, type ScrapeDeps } from '../scraper/willhaben.js';
import { notifyBelowMarket } from '../alerts/notify.js';
import type { Repository } from '../db/index.js';
import type {
  AppConfig,
  Emailer,
  Logger,
  NormalizedListing,
  WhatsAppSender,
} from '../types.js';

export interface PollDeps {
  repo: Repository;
  config: AppConfig;
  email?: Emailer | null;
  whatsapp?: WhatsAppSender | null;
  scrapeFn?: (config: AppConfig, deps?: ScrapeDeps) => Promise<NormalizedListing[]>;
  scrapeDeps?: ScrapeDeps;
  now?: () => string;
  logger?: Logger;
}

export interface PollResult {
  total: number;
  newCount: number;
  alerts: number;
}

// One poll cycle: scrape, upsert, deactivate stale, then alert on new below-market listings.
export async function runPoll({
  repo,
  config,
  email = null,
  whatsapp = null,
  scrapeFn = scrape,
  scrapeDeps = {},
  now = () => new Date().toISOString(),
  logger = console,
}: PollDeps): Promise<PollResult> {
  const runStart = now();
  const listings = await scrapeFn(config, scrapeDeps);
  logger.info?.(`poll: scraped ${listings.length} listings`);

  const results = repo.upsertMany(listings);
  const newIds = new Set(results.filter((r) => r.isNew).map((r) => r.id));
  const newListings = listings.filter((l) => newIds.has(l.id));
  const deactivated = repo.deactivateNotSeenSince(runStart);

  const fired = await notifyBelowMarket({
    repo,
    config,
    listings: newListings,
    email,
    whatsapp,
    logger,
  });

  logger.info?.(
    `poll: ${newListings.length} new, ${deactivated} deactivated, ${fired.length} alerts`,
  );
  return { total: listings.length, newCount: newListings.length, alerts: fired.length };
}
