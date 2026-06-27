import { describe, it, expect, beforeEach } from 'vitest';
import {
  getWillhabenAccessStatus,
  recordWillhabenForbidden,
  recordWillhabenSuccess,
  resetWillhabenAccessStatus,
} from '../src/lib/willhabenStatus.js';

describe('willhaben access status', () => {
  beforeEach(() => resetWillhabenAccessStatus());

  it('starts clear', () => {
    expect(getWillhabenAccessStatus()).toEqual({
      forbidden: false,
      lastForbiddenAt: null,
      lastSuccessAt: null,
      lastMessage: null,
    });
  });

  it('records a 403 and clears it after a successful request', () => {
    recordWillhabenForbidden('willhaben request failed: 403 Forbidden', '2026-06-10T12:00:00.000Z');
    expect(getWillhabenAccessStatus()).toMatchObject({
      forbidden: true,
      lastForbiddenAt: '2026-06-10T12:00:00.000Z',
      lastMessage: 'willhaben request failed: 403 Forbidden',
    });

    recordWillhabenSuccess('2026-06-10T12:05:00.000Z');
    expect(getWillhabenAccessStatus()).toMatchObject({
      forbidden: false,
      lastForbiddenAt: '2026-06-10T12:00:00.000Z',
      lastSuccessAt: '2026-06-10T12:05:00.000Z',
      lastMessage: null,
    });
  });
});
