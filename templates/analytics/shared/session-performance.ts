import { SLOW_REQUEST_THRESHOLD_MS } from "./slow-request.js";

export const WEB_VITALS_EVENT_NAME = "web_vitals";
export const SESSION_REPLAY_VITALS_EVENT_TAG = "agent-native.vitals";
/** A slow `action.response`, marked with that event's own timing. */
export const SESSION_REPLAY_SLOW_REQUEST_EVENT_TAG =
  "agent-native.slow_request";

export const PERFORMANCE_METRICS = [
  "ttfb",
  "lcp",
  "inp",
  "cls",
  "request",
] as const;
export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];
export type WebVitalMetric = Exclude<PerformanceMetric, "request">;

/** Google's published Core Web Vitals thresholds. */
export const WEB_VITAL_THRESHOLDS: Record<
  WebVitalMetric,
  { good: number; poor: number }
> = {
  ttfb: { good: 800, poor: 1_800 },
  lcp: { good: 2_500, poor: 4_000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
};

export type VitalRating = "good" | "needs-improvement" | "poor";

export function rateWebVital(
  metric: WebVitalMetric,
  value: number,
): VitalRating {
  const threshold = WEB_VITAL_THRESHOLDS[metric];
  if (value > threshold.poor) return "poor";
  return value > threshold.good ? "needs-improvement" : "good";
}

/** "4.2 s", "350 ms", or a CLS score like "0.12". Units are SI, not words. */
export function formatPerformanceValue(
  metric: PerformanceMetric,
  value: number,
): string {
  if (metric === "cls") return value.toFixed(2);
  return value < 1_000
    ? `${Math.round(value)} ms`
    : `${(value / 1_000).toFixed(1)} s`;
}

export const ROUTE_PERFORMANCE_RANGES = ["7d", "30d", "90d"] as const;
export type RoutePerformanceRange = (typeof ROUTE_PERFORMANCE_RANGES)[number];

export function readRoutePerformanceRange(
  value: string | null | undefined,
): RoutePerformanceRange {
  return ROUTE_PERFORMANCE_RANGES.includes(value as RoutePerformanceRange)
    ? (value as RoutePerformanceRange)
    : "7d";
}

/**
 * Whole UTC days, inclusive: 7d is today and the six days before it. A
 * rolling `now - 90d` timestamp would span 91 days and exceed the read's cap.
 */
export function routePerformanceRangeBounds(
  range: RoutePerformanceRange,
  now = new Date(),
): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const days = Number.parseInt(range, 10);
  const from = new Date(
    Date.parse(`${to}T00:00:00.000Z`) - (days - 1) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

export const SLOW_SESSION_FILTERS = ["any", "vitals", "requests"] as const;
export type SlowSessionFilter = (typeof SLOW_SESSION_FILTERS)[number];

export function isSlowSessionFilter(
  value: unknown,
): value is SlowSessionFilter {
  return (SLOW_SESSION_FILTERS as readonly unknown[]).includes(value);
}

/**
 * Fixed histogram bucket lower edges. Bucket `i` holds values in
 * `[edges[i], edges[i + 1])`; the last bucket is open-ended. Past the first
 * bucket each edge is at most 28% above the previous one, so a percentile
 * interpolated inside a bucket is within 28% of the exact value, and one in
 * the first bucket is within its width (1 ms, CLS 0.001), finer than the UI
 * shows. Every rating threshold and the slow-request threshold is an edge,
 * so counts above a threshold are exact. Changing these edges needs a new
 * `PERFORMANCE_HISTOGRAM_VERSION`, since stored buckets are positional.
 */
const DURATION_EDGES_MS = [
  0, 1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.4, 8, 10, 12.5, 16, 20, 25, 32, 40, 50,
  64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1_000, 1_250, 1_600,
  1_800, 2_000, 2_500, 3_200, 4_000, 5_000, 6_400, 8_000, 10_000, 12_500,
  16_000, 20_000, 25_000, 32_000, 40_000, 50_000, 64_000,
] as const;
const CLS_EDGES = [
  0, 0.001, 0.00125, 0.0016, 0.002, 0.0025, 0.0032, 0.004, 0.005, 0.0064, 0.008,
  0.01, 0.0125, 0.016, 0.02, 0.025, 0.032, 0.04, 0.05, 0.064, 0.08, 0.1, 0.125,
  0.16, 0.2, 0.25, 0.32, 0.4, 0.5, 0.64, 0.8, 1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5,
] as const;

export const PERFORMANCE_HISTOGRAM_VERSION = 1;

export function histogramEdges(metric: PerformanceMetric): readonly number[] {
  return metric === "cls" ? CLS_EDGES : DURATION_EDGES_MS;
}

/**
 * The open top bucket's floor. Ingest caps measurements here, so a stored
 * value at the ceiling means "at least this", never this exactly.
 */
export function performanceCeiling(metric: PerformanceMetric): number {
  const edges = histogramEdges(metric);
  return edges[edges.length - 1];
}

export function histogramBucket(
  metric: PerformanceMetric,
  value: number,
): number {
  const edges = histogramEdges(metric);
  let low = 0;
  let high = edges.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (edges[middle] <= value) low = middle;
    else high = middle - 1;
  }
  return low;
}

export interface HistogramPercentile {
  value: number;
  /** The percentile is in the open-ended top bucket, so this is a floor. */
  atLeast: boolean;
}

/**
 * The weighted percentile `p` (0..1) of a histogram, interpolated linearly
 * inside the bucket that holds it. Null when the histogram has no samples:
 * no data is not a fast route.
 */
export function histogramPercentile(
  metric: PerformanceMetric,
  weights: readonly number[],
  p: number,
): HistogramPercentile | null {
  const edges = histogramEdges(metric);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return null;
  const target = p * total;
  let cumulative = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const weight = weights[index] ?? 0;
    if (weight <= 0) continue;
    if (cumulative + weight >= target) {
      const low = edges[index];
      const high = edges[index + 1];
      if (high === undefined) return { value: low, atLeast: true };
      const fraction = Math.min(1, Math.max(0, (target - cumulative) / weight));
      return { value: low + fraction * (high - low), atLeast: false };
    }
    cumulative += weight;
  }
  return { value: edges[edges.length - 1], atLeast: true };
}

/** Weighted count of samples at or above `threshold`, which must be an edge. */
export function histogramCountAtLeast(
  metric: PerformanceMetric,
  weights: readonly number[],
  threshold: number,
): number {
  const first = histogramBucket(metric, threshold);
  let count = 0;
  for (let index = first; index < weights.length; index += 1) {
    count += weights[index] ?? 0;
  }
  return count;
}

export interface MetricSummary {
  /** Weighted sample count; request samples are scaled by their sampling. */
  samples: number;
  p50: HistogramPercentile | null;
  p95: HistogramPercentile | null;
}

export interface RouteRequestSummary extends MetricSummary {
  /** Requests that took at least `SLOW_REQUEST_THRESHOLD_MS`. Exact. */
  slow: number;
}

export interface RoutePerformanceRow {
  app: string;
  route: string;
  ttfb: MetricSummary | null;
  lcp: MetricSummary | null;
  inp: MetricSummary | null;
  cls: MetricSummary | null;
  request: RouteRequestSummary | null;
}

export interface RoutePerformanceResult {
  routes: RoutePerformanceRow[];
  /** Every app with measured routes in range, whatever the app filter. */
  apps: string[];
  /** When the viewer's performance aggregates began; null when they have not. */
  coverageStartedAt: string | null;
  /** Days in range whose aggregates are missing some events. */
  incompleteDates: string[];
  /** More routes matched than were returned. */
  truncated: boolean;
}

export function summarizeHistogram(
  metric: PerformanceMetric,
  weights: readonly number[],
): MetricSummary | null {
  const samples = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(samples > 0)) return null;
  return {
    samples,
    p50: histogramPercentile(metric, weights, 0.5),
    p95: histogramPercentile(metric, weights, 0.95),
  };
}

export function summarizeRequestHistogram(
  weights: readonly number[],
): RouteRequestSummary | null {
  const summary = summarizeHistogram("request", weights);
  if (!summary) return null;
  return {
    ...summary,
    slow: histogramCountAtLeast("request", weights, SLOW_REQUEST_THRESHOLD_MS),
  };
}

export const SESSION_PERFORMANCE_VALUES = {
  ttfbMs: "ttfb",
  lcpMs: "lcp",
  inpMs: "inp",
  cls: "cls",
  maxRequestMs: "request",
} as const satisfies Record<string, PerformanceMetric>;
export type SessionPerformanceValue = keyof typeof SESSION_PERFORMANCE_VALUES;

/** A recording's worst measured page view and its slow requests. */
export interface SessionPerformanceSummary {
  ttfbMs: number | null;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  /** Requests of at least `SLOW_REQUEST_THRESHOLD_MS`; null when none was measured. */
  slowRequests: number | null;
  maxRequestMs: number | null;
  /** Values that reached `performanceCeiling`, so each is a floor, not exact. */
  atLeast: SessionPerformanceValue[];
  /** Some of this session's measurements failed to save; it may be slower. */
  incomplete: boolean;
}

export interface SessionRecordingPerformance {
  /**
   * Each readable recording's summary, or null when it was never measured.
   * Ids the viewer cannot read are absent.
   */
  performance: Record<string, SessionPerformanceSummary | null>;
  /** When the viewer's performance aggregates began; null when they have not. */
  coverageStartedAt: string | null;
}
