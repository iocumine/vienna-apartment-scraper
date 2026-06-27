import type { BelowMarketResult } from '../types.js';

interface ListingLike {
  title?: string | null;
  url?: string | null;
  district?: number | null;
  rooms?: number | null;
  area_m2?: number | null;
  price?: number | null;
  price_per_m2?: number | null;
}

export function eur(n: unknown): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return 'n/a';
  return `EUR ${Number(n).toLocaleString('de-AT')}`;
}

export function pct(fraction: unknown): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(Number(fraction))) {
    return 'n/a';
  }
  return `${Math.round(Number(fraction) * 1000) / 10}%`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${day}d ${remHr}h` : `${day}d`;
}

export function formatReqPerMinute(rate: number): string {
  if (!Number.isFinite(rate)) return 'n/a';
  if (rate >= 100) return rate.toFixed(0);
  if (rate >= 10) return rate.toFixed(1);
  return rate.toFixed(2);
}

export interface AlertItem {
  listing: ListingLike;
  evalResult: BelowMarketResult;
}

function detailLines(listing: ListingLike, evalResult: BelowMarketResult): string[] {
  return [
    `${listing.title ?? 'Untitled'}`,
    `District ${listing.district} | ${listing.rooms ?? '?'} rooms | ${listing.area_m2 ?? '?'} m2`,
    `Price: ${eur(listing.price)} (${eur(listing.price_per_m2)}/m2)`,
    `District baseline: ${eur(evalResult.baseline)}/m2 -> ${pct(evalResult.deltaPct)} below`,
    `${listing.url}`,
  ];
}

function detailHtml(listing: ListingLike, evalResult: BelowMarketResult): string {
  return `
  <p><strong>${escapeHtml(listing.title ?? 'Untitled')}</strong></p>
  <ul>
    <li>District: ${listing.district}</li>
    <li>Rooms: ${listing.rooms ?? '?'} &middot; Area: ${listing.area_m2 ?? '?'} m&sup2;</li>
    <li>Price: ${eur(listing.price)} (<strong>${eur(listing.price_per_m2)}/m&sup2;</strong>)</li>
    <li>District baseline: ${eur(evalResult.baseline)}/m&sup2; (<strong>${pct(evalResult.deltaPct)} below</strong>)</li>
  </ul>
  <p><a href="${escapeHtml(listing.url)}">View listing</a></p>`;
}

export function formatAlertText(listing: ListingLike, evalResult: BelowMarketResult): string {
  return ['Below-market apartment found!', ...detailLines(listing, evalResult)].join('\n');
}

export function formatAlertHtml(listing: ListingLike, evalResult: BelowMarketResult): string {
  return `
  <h2>Below-market apartment found</h2>${detailHtml(listing, evalResult)}`;
}

// Combine several below-market hits from one polling round into a single email.
export function formatAlertsText(alerts: AlertItem[]): string {
  if (alerts.length === 1) return formatAlertText(alerts[0]!.listing, alerts[0]!.evalResult);
  const header = `${alerts.length} below-market apartments found!`;
  const blocks = alerts.map((a) => detailLines(a.listing, a.evalResult).join('\n'));
  return [header, '', blocks.join('\n\n')].join('\n');
}

export function formatAlertsHtml(alerts: AlertItem[]): string {
  if (alerts.length === 1) return formatAlertHtml(alerts[0]!.listing, alerts[0]!.evalResult);
  const header = `<h2>${alerts.length} below-market apartments found</h2>`;
  const blocks = alerts.map((a) => detailHtml(a.listing, a.evalResult)).join('\n  <hr />');
  return `
  ${header}${blocks}`;
}
