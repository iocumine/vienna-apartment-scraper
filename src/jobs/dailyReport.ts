import { deltaBelow } from '../lib/metrics.js';
import { eur, pct, escapeHtml } from '../alerts/format.js';
import type { Repository } from '../db/index.js';
import type { AppConfig, Emailer, ListingRow, Logger } from '../types.js';

export interface ReportListing extends ListingRow {
  deltaPct: number | null;
}

export interface ReportDistrictGroup {
  district: number;
  baseline: number | null;
  listings: ReportListing[];
}

export interface ReportSummary {
  count: number;
  groups: ReportDistrictGroup[];
}

type BaselineLookup = (district: number) => number | null;

// Group new listings by district and attach the sqm-price delta vs the district baseline.
export function summarizeNewListings(
  listings: ListingRow[],
  getBaseline: BaselineLookup,
): ReportSummary {
  const byDistrict = new Map<number, ListingRow[]>();
  for (const l of listings) {
    const d = l.district ?? -1;
    if (!byDistrict.has(d)) byDistrict.set(d, []);
    byDistrict.get(d)!.push(l);
  }
  const groups: ReportDistrictGroup[] = [...byDistrict.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([district, rows]) => {
      const baseline = district >= 0 ? getBaseline(district) : null;
      const enriched = rows
        .map((l) => ({ ...l, deltaPct: deltaBelow(l.price_per_m2, baseline) }))
        .sort((a, b) => (a.price_per_m2 ?? Infinity) - (b.price_per_m2 ?? Infinity));
      return { district, baseline, listings: enriched };
    });
  return { count: listings.length, groups };
}

export function renderDailyReportText(summary: ReportSummary, dateLabel: string): string {
  if (summary.count === 0) return `No new apartments found on ${dateLabel}.`;
  const lines = [`${summary.count} new apartment(s) on ${dateLabel}`, ''];
  for (const g of summary.groups) {
    lines.push(`== District ${g.district} (baseline ${eur(g.baseline)}/m2) ==`);
    for (const l of g.listings) {
      lines.push(
        `- ${l.title ?? 'Untitled'} | ${eur(l.price)} | ${l.area_m2 ?? '?'} m2 | ${eur(l.price_per_m2)}/m2 (${pct(l.deltaPct)} vs baseline)`,
      );
      lines.push(`  ${l.url ?? ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderDailyReportHtml(summary: ReportSummary, dateLabel: string): string {
  if (summary.count === 0) {
    return `<h1>Daily apartment report</h1><p>No new apartments found on ${escapeHtml(dateLabel)}.</p>`;
  }
  const sections = summary.groups
    .map((g) => {
      const rows = g.listings
        .map(
          (l) => `
        <tr>
          <td><a href="${escapeHtml(l.url)}">${escapeHtml(l.title ?? 'Untitled')}</a></td>
          <td>${escapeHtml(eur(l.price))}</td>
          <td>${l.area_m2 ?? '?'}</td>
          <td>${l.rooms ?? '?'}</td>
          <td>${escapeHtml(eur(l.price_per_m2))}</td>
          <td>${escapeHtml(pct(l.deltaPct))}</td>
        </tr>`,
        )
        .join('');
      return `
      <h2>District ${g.district} <small>(baseline ${escapeHtml(eur(g.baseline))}/m&sup2;)</small></h2>
      <table border="1" cellpadding="6" cellspacing="0">
        <thead><tr><th>Title</th><th>Price</th><th>m&sup2;</th><th>Rooms</th><th>EUR/m&sup2;</th><th>vs baseline</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    })
    .join('');
  return `<h1>Daily apartment report &mdash; ${escapeHtml(dateLabel)}</h1>
  <p>${summary.count} new apartment(s).</p>${sections}`;
}

export interface DailyReportDeps {
  repo: Repository;
  config: AppConfig;
  email?: Emailer | null;
  now?: () => string;
  logger?: Logger;
}

// Build and send the last-24h report. Returns the summary (also when no email configured).
export async function runDailyReport({
  repo,
  config,
  email = null,
  now = () => new Date().toISOString(),
  logger = console,
}: DailyReportDeps): Promise<ReportSummary> {
  const nowIso = now();
  const since = new Date(new Date(nowIso).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const listings = repo.getNewListingsSince(since);
  const summary = summarizeNewListings(listings, (d) =>
    repo.getDistrictBaseline(d, config.statsWindowDays, nowIso.slice(0, 10)),
  );
  const dateLabel = nowIso.slice(0, 10);

  if (email && config.reportEmailTo) {
    try {
      await email.send({
        to: config.reportEmailTo,
        subject: `Daily apartment report (${dateLabel}): ${summary.count} new`,
        text: renderDailyReportText(summary, dateLabel),
        html: renderDailyReportHtml(summary, dateLabel),
      });
    } catch (err) {
      logger.warn?.(`daily report email failed: ${(err as Error).message}`);
    }
  }
  logger.info?.(`daily report: ${summary.count} new listings`);
  return summary;
}
