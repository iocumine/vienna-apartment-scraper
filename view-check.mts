import Database from 'better-sqlite3';
import { createRepository } from './src/db/index.js';
import { buildActiveListings, buildNewListings } from './src/web/data.js';
import { renderListings, renderNewListings } from './src/web/views.js';

const repo = createRepository(new Database(':memory:'));
repo.upsertListing({ id: 'a1', title: 'Flat', url: 'https://x/1', district: 7, postcode: 1070, rooms: 2, area_m2: 50, price: 1000, price_per_m2: 20, lat: 48.2, lng: 16.3, published_at: null });

const pages: Record<string, string> = {
  listings: renderListings(buildActiveListings(repo)),
  newListings: renderNewListings(buildNewListings(repo)),
};
let ok = true;
for (const [name, html] of Object.entries(pages)) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  scripts.forEach((body, i) => {
    try { new Function(body); console.log(`${name} script #${i + 1}: OK`); }
    catch (err) { ok = false; console.error(`${name} script #${i + 1}: ${(err as Error).message}`); }
  });
}
console.log(ok ? 'ALL SCRIPTS PARSE OK' : 'SCRIPT SYNTAX FAILED');
process.exit(ok ? 0 : 1);
