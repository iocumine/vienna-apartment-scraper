import { describe, it, expect } from 'vitest';
import {
  loadConfig,
  parseDistricts,
  parseEmails,
  postcodeForDistrict,
  districtForPostcode,
  DEFAULT_DISTRICTS,
} from '../src/config.js';

describe('district <-> postcode mapping', () => {
  it('maps districts to Vienna postcodes', () => {
    expect(postcodeForDistrict(2)).toBe(1020);
    expect(postcodeForDistrict(9)).toBe(1090);
    expect(postcodeForDistrict(17)).toBe(1170);
    expect(postcodeForDistrict('19')).toBe(1190);
  });

  it('returns null for unknown districts', () => {
    expect(postcodeForDistrict(99)).toBeNull();
  });

  it('derives district from postcode', () => {
    expect(districtForPostcode(1020)).toBe(2);
    expect(districtForPostcode(1190)).toBe(19);
    expect(districtForPostcode('1070')).toBe(7);
  });

  it('returns null for non-Vienna postcodes', () => {
    expect(districtForPostcode(5020)).toBeNull();
    expect(districtForPostcode('abc')).toBeNull();
  });
});

describe('parseDistricts', () => {
  it('parses a comma-separated list', () => {
    expect(parseDistricts('2, 7,9')).toEqual([2, 7, 9]);
  });

  it('falls back to defaults when empty or invalid', () => {
    expect(parseDistricts('')).toEqual(DEFAULT_DISTRICTS);
    expect(parseDistricts(undefined)).toEqual(DEFAULT_DISTRICTS);
    expect(parseDistricts('99,foo')).toEqual(DEFAULT_DISTRICTS);
  });

  it('ignores invalid entries but keeps valid ones', () => {
    expect(parseDistricts('2,foo,8')).toEqual([2, 8]);
  });
});

describe('parseEmails', () => {
  it('parses a comma- or semicolon-separated list and trims', () => {
    expect(parseEmails('a@x.com, b@y.com;c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('dedups repeated addresses', () => {
    expect(parseEmails('a@x.com, a@x.com')).toEqual(['a@x.com']);
  });

  it('falls back when empty or missing', () => {
    expect(parseEmails('', ['fallback@x.com'])).toEqual(['fallback@x.com']);
    expect(parseEmails(undefined, ['fallback@x.com'])).toEqual(['fallback@x.com']);
    expect(parseEmails('   ')).toEqual([]);
  });
});

describe('loadConfig', () => {
  it('applies sensible defaults from an empty env', () => {
    const cfg = loadConfig({});
    expect(cfg.transactionType).toBe('rent');
    expect(cfg.districts).toEqual(DEFAULT_DISTRICTS);
    expect(cfg.roomsMin).toBe(1);
    expect(cfg.roomsMax).toBe(2);
    expect(cfg.alertThresholdPct).toBeCloseTo(0.15);
    expect(cfg.port).toBe(3000);
    expect(cfg.smtp.host).toBe('smtp.gmail.com');
    expect(cfg.verificationMissThreshold).toBe(5);
    expect(cfg.willhabenRequestsPerMinute).toBe(50);
  });

  it('reads overrides from env', () => {
    const cfg = loadConfig({
      TRANSACTION_TYPE: 'buy',
      DISTRICTS: '6,7',
      ROOMS_MIN: '2',
      ALERT_THRESHOLD_PCT: '0.2',
      PORT: '8080',
      SMTP_USER: 'me@gmail.com',
    });
    expect(cfg.transactionType).toBe('buy');
    expect(cfg.districts).toEqual([6, 7]);
    expect(cfg.roomsMin).toBe(2);
    expect(cfg.alertThresholdPct).toBeCloseTo(0.2);
    expect(cfg.port).toBe(8080);
    expect(cfg.alertEmailTo).toEqual(['me@gmail.com']);
    expect(cfg.smtp.from).toBe('me@gmail.com');
  });

  it('parses multiple alert/report recipients and defaults them to SMTP_USER', () => {
    const cfg = loadConfig({
      SMTP_USER: 'me@gmail.com',
      ALERT_EMAIL_TO: 'a@x.com, b@y.com',
    });
    expect(cfg.alertEmailTo).toEqual(['a@x.com', 'b@y.com']);
    // REPORT_EMAIL_TO unset -> falls back to SMTP_USER.
    expect(cfg.reportEmailTo).toEqual(['me@gmail.com']);
  });

  it('defaults numeric fields when given garbage', () => {
    const cfg = loadConfig({ PORT: 'not-a-number', ROOMS_MAX: '' });
    expect(cfg.port).toBe(3000);
    expect(cfg.roomsMax).toBe(2);
  });
});
