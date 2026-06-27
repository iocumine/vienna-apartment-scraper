import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabaseDiskUsageBytes } from '../src/lib/dbStorage.js';

describe('getDatabaseDiskUsageBytes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vienna-db-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for in-memory databases', () => {
    expect(getDatabaseDiskUsageBytes(':memory:')).toBeNull();
  });

  it('returns null when the database file does not exist', () => {
    expect(getDatabaseDiskUsageBytes(path.join(tmpDir, 'missing.db'))).toBeNull();
  });

  it('sums the main database file and WAL sidecar sizes', () => {
    const dbPath = path.join(tmpDir, 'listings.db');
    fs.writeFileSync(dbPath, Buffer.alloc(1000));
    fs.writeFileSync(`${dbPath}-wal`, Buffer.alloc(200));
    fs.writeFileSync(`${dbPath}-shm`, Buffer.alloc(50));
    expect(getDatabaseDiskUsageBytes(dbPath)).toBe(1250);
  });
});
