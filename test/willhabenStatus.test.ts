import { describe, it, expect, beforeEach } from 'vitest';
import {
  getWillhabenAccessStatus,
  getVerificationRateLimitStatus,
  recordWillhabenForbidden,
  recordWillhabenSuccess,
  recordVerificationDeferred,
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
    expect(getVerificationRateLimitStatus()).toEqual({
      deferred: false,
      deferredCount: 0,
      lastDeferredAt: null,
      requestsPerMinuteLimit: 25,
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

  it('records deferred verification checks when rate limited', () => {
    recordVerificationDeferred(5, 50, '2026-06-10T12:00:00.000Z');
    expect(getVerificationRateLimitStatus()).toMatchObject({
      deferred: true,
      deferredCount: 5,
      lastDeferredAt: '2026-06-10T12:00:00.000Z',
      requestsPerMinuteLimit: 50,
    });
  });
});
