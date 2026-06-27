import { movingAverage } from '../lib/metrics.js';
import type { Repository } from '../db/index.js';
import type { AppConfig, ListingRow } from '../types.js';

export interface Summary {
  generatedAt: string;
  activeCount: number;
  newCount: number;
  districts: ReturnType<Repository['computeCurrentDistrictStats']>;
  newListings: ListingRow[];
}

export function buildSummary(
  repo: Repository,
  _config: AppConfig,
  now: () => string = () => new Date().toISOString(),
): Summary {
  const nowIso = now();
  const since = new Date(new Date(nowIso).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const newListings = repo.getNewListingsSince(since);
  return {
    generatedAt: nowIso,
    activeCount: repo.countActive(),
    newCount: newListings.length,
    districts: repo.computeCurrentDistrictStats(),
    newListings,
  };
}

export interface TrendPoint {
  date: string;
  median: number | null;
  avg: number | null;
  count: number;
  // Trailing moving averages of the median series (per-district tiles).
  ma5: number | null;
  ma20: number | null;
}

export interface TrendSeries {
  district: number;
  points: TrendPoint[];
}

export interface Trends {
  dates: string[];
  series: TrendSeries[];
}

// Pivot the daily stats history into per-district time series for charting.
export function buildTrends(repo: Repository): Trends {
  const history = repo.getDistrictStatsHistory();
  const dates = [...new Set(history.map((r) => r.date))].sort();
  const byDistrict = new Map<number, TrendPoint[]>();
  for (const r of history) {
    if (!byDistrict.has(r.district)) byDistrict.set(r.district, []);
    byDistrict.get(r.district)!.push({
      date: r.date,
      median: r.median_price_per_m2,
      avg: r.avg_price_per_m2,
      count: r.active_count,
      ma5: null,
      ma20: null,
    });
  }
  const series: TrendSeries[] = [...byDistrict.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([district, points]) => {
      const sorted = points.sort((a, b) => a.date.localeCompare(b.date));
      const medians = sorted.map((p) => p.median);
      const ma5 = movingAverage(medians, 5);
      const ma20 = movingAverage(medians, 20);
      sorted.forEach((p, i) => {
        p.ma5 = ma5[i] ?? null;
        p.ma20 = ma20[i] ?? null;
      });
      return { district, points: sorted };
    });
  return { dates, series };
}

export interface ListingsRow {
  id: string;
  title: string | null;
  url: string | null;
  district: number | null;
  rooms: number | null;
  area_m2: number | null;
  price: number | null;
  price_per_m2: number | null;
}

// All currently-active listings for the standalone listings page, sorted by
// district then price as a sensible default before client-side sort/filter.
export function buildActiveListings(repo: Repository): ListingsRow[] {
  return repo
    .getActiveListings()
    .map((l) => ({
      id: String(l.id),
      title: l.title ?? null,
      url: l.url ?? null,
      district: l.district ?? null,
      rooms: l.rooms ?? null,
      area_m2: l.area_m2 ?? null,
      price: l.price ?? null,
      price_per_m2: l.price_per_m2 ?? null,
    }))
    .sort(
      (a, b) =>
        (a.district ?? Infinity) - (b.district ?? Infinity) ||
        (a.price ?? Infinity) - (b.price ?? Infinity),
    );
}

export interface MapPoint {
  id: string;
  title: string | null;
  url: string | null;
  district: number | null;
  rooms: number | null;
  area_m2: number | null;
  price: number | null;
  price_per_m2: number | null;
  lat: number | null;
  lng: number | null;
  districtMedian: number | null;
  belowMedian: boolean;
}

// Active geocoded listings, each tagged with its district median for map coloring.
export function buildMapData(repo: Repository): MapPoint[] {
  const medians = new Map<number, number | null>();
  for (const s of repo.computeCurrentDistrictStats()) {
    medians.set(s.district, s.median_price_per_m2);
  }
  return repo.getListingsForMap().map((l) => {
    const districtMedian = l.district != null ? medians.get(l.district) ?? null : null;
    const belowMedian =
      districtMedian != null && l.price_per_m2 != null && l.price_per_m2 < districtMedian;
    return {
      id: String(l.id),
      title: l.title ?? null,
      url: l.url ?? null,
      district: l.district ?? null,
      rooms: l.rooms ?? null,
      area_m2: l.area_m2 ?? null,
      price: l.price ?? null,
      price_per_m2: l.price_per_m2 ?? null,
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      districtMedian,
      belowMedian,
    };
  });
}
