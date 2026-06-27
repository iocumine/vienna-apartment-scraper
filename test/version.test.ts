import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../src/lib/version.js';

describe('APP_VERSION', () => {
  it('reads the version from package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe('1.0.1');
  });
});
