import { describe, it, expect } from 'vitest';
import { round2, pricePerM2, average, median, deltaBelow } from '../src/lib/metrics.js';

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(1.23456)).toBe(1.23);
    expect(round2(10)).toBe(10);
  });
  it('returns null for non-numbers', () => {
    expect(round2('x')).toBeNull();
    expect(round2(undefined)).toBeNull();
  });
});

describe('pricePerM2', () => {
  it('divides price by area', () => {
    expect(pricePerM2(1000, 50)).toBe(20);
    expect(pricePerM2(900, 45)).toBe(20);
  });
  it('returns null for invalid inputs', () => {
    expect(pricePerM2(1000, 0)).toBeNull();
    expect(pricePerM2(0, 50)).toBeNull();
    expect(pricePerM2(1000, null)).toBeNull();
  });
});

describe('average', () => {
  it('computes the mean', () => {
    expect(average([10, 20, 30])).toBe(20);
  });
  it('ignores non-numeric values', () => {
    expect(average([10, 'x', 30])).toBe(20);
  });
  it('returns null for empty input', () => {
    expect(average([])).toBeNull();
  });
});

describe('median', () => {
  it('handles odd-length arrays', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the two middle values for even-length arrays', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns null for empty input', () => {
    expect(median([])).toBeNull();
  });
});

describe('deltaBelow', () => {
  it('computes the fraction below the baseline', () => {
    expect(deltaBelow(80, 100)).toBeCloseTo(0.2);
    expect(deltaBelow(100, 100)).toBeCloseTo(0);
    expect(deltaBelow(120, 100)).toBeCloseTo(-0.2);
  });
  it('returns null for invalid baseline', () => {
    expect(deltaBelow(80, 0)).toBeNull();
    expect(deltaBelow(80, null)).toBeNull();
  });
});
