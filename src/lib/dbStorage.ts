import fs from 'node:fs';
import path from 'node:path';

/** Total on-disk size of the SQLite database file and any WAL sidecar files. */
export function getDatabaseDiskUsageBytes(dbPath: string | undefined): number | null {
  if (!dbPath || dbPath === ':memory:') return null;
  const resolved = path.resolve(dbPath);
  let total = 0;
  let found = false;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += fs.statSync(resolved + suffix).size;
      found = true;
    } catch {
      // Sidecar files may not exist yet.
    }
  }
  return found ? total : null;
}
