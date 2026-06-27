export function round2(n: unknown): number | null {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

export function pricePerM2(price: unknown, areaM2: unknown): number | null {
  const p = Number(price);
  const a = Number(areaM2);
  if (!Number.isFinite(p) || !Number.isFinite(a) || a <= 0 || p <= 0) return null;
  return round2(p / a);
}

export function average(values: unknown[]): number | null {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  return round2(nums.reduce((sum, n) => sum + n, 0) / nums.length);
}

export function median(values: unknown[]): number | null {
  const nums = (values || [])
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  const m = nums.length % 2 === 0 ? (nums[mid - 1]! + nums[mid]!) / 2 : nums[mid]!;
  return round2(m);
}

// Trailing simple moving average over a series (e.g. one daily snapshot per
// entry). output[i] is the average of up to `window` values ending at i, using
// only finite values; null when the window holds no finite value. Early indices
// use however many points are available (a partial window).
export function movingAverage(values: unknown[], window: number): (number | null)[] {
  if (!Array.isArray(values) || !Number.isInteger(window) || window <= 0) return [];
  return values.map((_, i) => {
    const win = values
      .slice(Math.max(0, i - window + 1), i + 1)
      .filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)));
    return average(win);
  });
}

// Fraction below the baseline: 0.2 means the value is 20% under baseline.
export function deltaBelow(value: unknown, baseline: unknown): number | null {
  const v = Number(value);
  const b = Number(baseline);
  if (!Number.isFinite(v) || !Number.isFinite(b) || b <= 0) return null;
  return (b - v) / b;
}
