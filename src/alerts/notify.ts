import { detectBelowMarket, ALERT_TYPE_BELOW_MARKET } from './rules.js';
import { formatAlertsText, formatAlertsHtml } from './format.js';
import type { Repository } from '../db/index.js';
import type {
  AppConfig,
  BelowMarketResult,
  Emailer,
  ListingRow,
  Logger,
  NormalizedListing,
} from '../types.js';

type ListingLike = NormalizedListing | ListingRow;

export interface NotifyDeps {
  repo: Repository;
  config: AppConfig;
  listings: ListingLike[];
  email?: Emailer | null;
  logger?: Logger;
}

export interface FiredAlert {
  listing: ListingLike;
  evalResult: BelowMarketResult;
}

// Evaluate freshly-seen listings against their district baseline, then send a
// single email summarizing every below-market hit from this polling round
// (instead of one email per listing). Alerts are deduped via the repo and only
// recorded as sent once the email is delivered.
export async function notifyBelowMarket({
  repo,
  config,
  listings,
  email,
  logger = console,
}: NotifyDeps): Promise<FiredAlert[]> {
  const candidates: FiredAlert[] = [];
  for (const listing of listings) {
    if (listing.district === null || listing.district === undefined) continue;
    if (repo.hasAlertBeenSent(listing.id, ALERT_TYPE_BELOW_MARKET)) continue;

    const baseline = repo.getDistrictBaseline(listing.district, config.statsWindowDays);
    const evalResult = detectBelowMarket(listing, baseline, config.alertThresholdPct);
    if (!evalResult.triggered) continue;

    candidates.push({ listing, evalResult });
  }

  if (candidates.length === 0) return [];
  if (!email || config.alertEmailTo.length === 0) return [];

  const subject =
    candidates.length === 1
      ? `Cheap ${candidates[0]!.listing.rooms ?? ''}-room flat in District ${candidates[0]!.listing.district}: EUR ${candidates[0]!.listing.price}`
      : `${candidates.length} below-market apartments found`;
  const text = formatAlertsText(candidates);
  const html = formatAlertsHtml(candidates);

  try {
    await email.send({ to: config.alertEmailTo, subject, text, html });
  } catch (err) {
    logger.warn?.(
      `email alert failed for ${candidates.length} listing(s): ${(err as Error).message}`,
    );
    return [];
  }

  for (const { listing } of candidates) {
    repo.recordAlertSent(listing.id, ALERT_TYPE_BELOW_MARKET);
  }
  return candidates;
}
