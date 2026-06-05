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

export function formatAlertText(listing: ListingLike, evalResult: BelowMarketResult): string {
  const lines = [
    'Below-market apartment found!',
    `${listing.title ?? 'Untitled'}`,
    `District ${listing.district} | ${listing.rooms ?? '?'} rooms | ${listing.area_m2 ?? '?'} m2`,
    `Price: ${eur(listing.price)} (${eur(listing.price_per_m2)}/m2)`,
    `District baseline: ${eur(evalResult.baseline)}/m2 -> ${pct(evalResult.deltaPct)} below`,
    `${listing.url}`,
  ];
  return lines.join('\n');
}

export function formatAlertHtml(listing: ListingLike, evalResult: BelowMarketResult): string {
  return `
  <h2>Below-market apartment found</h2>
  <p><strong>${escapeHtml(listing.title ?? 'Untitled')}</strong></p>
  <ul>
    <li>District: ${listing.district}</li>
    <li>Rooms: ${listing.rooms ?? '?'} &middot; Area: ${listing.area_m2 ?? '?'} m&sup2;</li>
    <li>Price: ${eur(listing.price)} (<strong>${eur(listing.price_per_m2)}/m&sup2;</strong>)</li>
    <li>District baseline: ${eur(evalResult.baseline)}/m&sup2; (<strong>${pct(evalResult.deltaPct)} below</strong>)</li>
  </ul>
  <p><a href="${escapeHtml(listing.url)}">View listing</a></p>`;
}
