import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readAppVersion(): string {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  try {
    return (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

export const APP_VERSION = readAppVersion();
