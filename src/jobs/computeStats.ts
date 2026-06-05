import type { Repository } from '../db/index.js';
import type { DailyStatRow, Logger } from '../types.js';

export interface StatsDeps {
  repo: Repository;
  now?: () => string;
  logger?: Logger;
}

// Snapshot per-district avg/median sqm price + active count for the current day.
export function runStatsSnapshot({
  repo,
  now = () => new Date().toISOString(),
  logger = console,
}: StatsDeps): DailyStatRow[] {
  const date = now().slice(0, 10);
  const rows = repo.snapshotDailyStats(date);
  logger.info?.(`stats: snapshotted ${rows.length} districts for ${date}`);
  return rows;
}
