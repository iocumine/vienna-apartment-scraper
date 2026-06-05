import { deltaBelow } from '../lib/metrics.js';
import type { BelowMarketResult, NormalizedListing } from '../types.js';

export const ALERT_TYPE_BELOW_MARKET = 'below_market';

// Decide whether a listing is meaningfully below the district baseline sqm price.
// thresholdPct is a fraction (0.15 => 15% below baseline triggers an alert).
export function detectBelowMarket(
  listing: Pick<NormalizedListing, 'price_per_m2'>,
  baseline: number | null,
  thresholdPct: number,
): BelowMarketResult {
  const rawPpm2 = listing?.price_per_m2;
  const ppm2 = rawPpm2 === null || rawPpm2 === undefined ? NaN : Number(rawPpm2);
  const base = baseline === null || baseline === undefined ? NaN : Number(baseline);
  const result: BelowMarketResult = {
    triggered: false,
    pricePerM2: Number.isFinite(ppm2) ? ppm2 : null,
    baseline: Number.isFinite(base) ? base : null,
    deltaPct: null,
  };
  if (!Number.isFinite(ppm2) || !Number.isFinite(base) || base <= 0) return result;
  const delta = deltaBelow(ppm2, base);
  result.deltaPct = delta;
  result.triggered = delta !== null && delta >= thresholdPct;
  return result;
}
