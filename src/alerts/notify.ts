import { detectBelowMarket, ALERT_TYPE_BELOW_MARKET } from './rules.js';
import { formatAlertText, formatAlertHtml } from './format.js';
import type { Repository } from '../db/index.js';
import type {
  AppConfig,
  BelowMarketResult,
  Emailer,
  ListingRow,
  Logger,
  NormalizedListing,
  WhatsAppSender,
} from '../types.js';

type ListingLike = NormalizedListing | ListingRow;

export interface NotifyDeps {
  repo: Repository;
  config: AppConfig;
  listings: ListingLike[];
  email?: Emailer | null;
  whatsapp?: WhatsAppSender | null;
  logger?: Logger;
}

export interface FiredAlert {
  listing: ListingLike;
  evalResult: BelowMarketResult;
}

// Evaluate freshly-seen listings against their district baseline and send
// email + WhatsApp alerts for below-market ones, deduping via the repo.
export async function notifyBelowMarket({
  repo,
  config,
  listings,
  email,
  whatsapp,
  logger = console,
}: NotifyDeps): Promise<FiredAlert[]> {
  const fired: FiredAlert[] = [];
  for (const listing of listings) {
    if (listing.district === null || listing.district === undefined) continue;
    if (repo.hasAlertBeenSent(listing.id, ALERT_TYPE_BELOW_MARKET)) continue;

    const baseline = repo.getDistrictBaseline(listing.district, config.statsWindowDays);
    const evalResult = detectBelowMarket(listing, baseline, config.alertThresholdPct);
    if (!evalResult.triggered) continue;

    const subject = `Cheap ${listing.rooms ?? ''}-room flat in District ${listing.district}: EUR ${listing.price}`;
    const text = formatAlertText(listing, evalResult);
    const html = formatAlertHtml(listing, evalResult);

    let delivered = false;
    if (email && config.alertEmailTo) {
      try {
        await email.send({ to: config.alertEmailTo, subject, text, html });
        delivered = true;
      } catch (err) {
        logger.warn?.(`email alert failed for ${listing.id}: ${(err as Error).message}`);
      }
    }
    if (whatsapp && config.whatsapp?.enabled && config.whatsapp?.to) {
      try {
        await whatsapp.send(config.whatsapp.to, text);
        delivered = true;
      } catch (err) {
        logger.warn?.(`whatsapp alert failed for ${listing.id}: ${(err as Error).message}`);
      }
    }

    if (delivered) {
      repo.recordAlertSent(listing.id, ALERT_TYPE_BELOW_MARKET);
      fired.push({ listing, evalResult });
    }
  }
  return fired;
}
