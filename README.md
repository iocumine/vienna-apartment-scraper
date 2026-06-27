# Vienna Apartment Scraper & Alerting Service

A self-hosted TypeScript/Node.js service that periodically scrapes
[willhaben.at](https://www.willhaben.at/) for 1-2 room apartments in selected
Vienna districts, stores them in SQLite, tracks square-meter prices over time,
serves a dashboard (charts + map), sends a daily report, and alerts you by
email when a new listing is priced below the district's usual sqm price.

## Features

- Periodic scraping of willhaben (Vienna-wide, filtered to your districts and room count).
- SQLite storage with listing dedup and active/inactive tracking (inactive only after willhaben verification).
- Per-district square-meter price stats, snapshotted daily for time-series charts.
- Server-rendered dashboard:
  - Overview of new listings + current sqm prices.
  - `/trends` - median sqm price per district over time (Chart.js).
  - `/map` - listings on an OpenStreetMap/Leaflet map, colored by price vs district median.
- Daily email report of the last 24h of new listings, grouped by district.
- Below-market alerts via email (Gmail SMTP), to one or more recipients.

## Tech stack

- TypeScript on Node.js 22, ESM (`NodeNext`).
- `better-sqlite3`, `express`, `node-cron`, `nodemailer`.
- Maps: Leaflet + OpenStreetMap (no API key). Charts: Chart.js (CDN).
- Tests: Vitest with v8 coverage.

## Configuration

Copy `.env.example` to `.env` and adjust:

```bash
cp .env.example .env
```

Key variables (see `.env.example` for the full list):

- `DISTRICTS` - comma-separated Vienna districts (default `2,3,6,7,8,9,17,18,19`).
- `TRANSACTION_TYPE` - `rent` or `buy`.
- `ROOMS_MIN` / `ROOMS_MAX` - room range (default 1-2).
- `POLL_INTERVAL_CRON` - how often to scrape (default every 45 min).
- `VERIFICATION_MISS_THRESHOLD` - consecutive poll misses before checking willhaben whether a listing is still active (default `5`; also requires 12h since last seen).
- `WILLHABEN_REQUESTS_PER_MINUTE` - cap on willhaben HTTP requests in any rolling 60s window (default `50`).
- `ALERT_THRESHOLD_PCT` - fraction below district median that triggers an alert (default `0.15`).
- `SMTP_USER` / `SMTP_PASS` - Gmail address + [app password](https://support.google.com/accounts/answer/185833).
- `ALERT_EMAIL_TO` / `REPORT_EMAIL_TO` - recipient(s) for alerts and the daily report. Accepts a single address or a comma-separated list (e.g. `me@x.com, partner@y.com`); defaults to `SMTP_USER`.

## Run locally (development)

```bash
npm install
npm run dev        # tsx watch, runs scheduler + dashboard
```

Dashboard: http://localhost:3000

Run a single scrape cycle (useful to verify the scraper):

```bash
npm run poll:once
```

## Run with Docker

```bash
docker compose up --build
```

- The dashboard is exposed on `PORT` (default 3000).
- SQLite data is persisted in `./data` (mounted volume).

## Tests & coverage

```bash
npm test              # run all unit tests
npm run test:coverage # run with coverage; fails below the configured thresholds
npm run typecheck     # tsc --noEmit
```

Coverage thresholds (lines, branches, functions, statements) are configured in
[`src/test/coverage.config.ts`](src/test/coverage.config.ts) and enforced by
`npm run test:coverage`.

## Project structure

```
src/
  config.ts            # env loading, district<->postcode mapping
  types.ts             # shared types
  lib/metrics.ts       # pure math helpers (median, price/m2, etc.)
  db/                  # SQLite repository + schema.sql
  scraper/willhaben.ts # search URL builder, __NEXT_DATA__ parsing, normalize
  jobs/                # poll, computeStats, dailyReport
  alerts/              # rules, formatting, email, notify orchestration
  web/                 # data builders, HTML views, express server
  index.ts             # boots scheduler + dashboard
  scripts/poll-once.ts # one-shot poll
test/                  # vitest specs + fixtures
```

## Notes / limitations

- willhaben has no official public API; the scraper reads the page's embedded
  `__NEXT_DATA__` JSON. If willhaben changes structure or adds anti-bot defenses,
  the parsing in `src/scraper/willhaben.ts` may need updating. Keep polling
  infrequent and for personal use only.
- SQLite is used for simplicity; the schema and queries port easily to Postgres
  if you later need higher write concurrency.
