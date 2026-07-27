/**
 * Client-side shapes for the reusable uptime charts. These MIRROR the server
 * aggregates in server/lib/monitor-stats.ts (`UptimeBucket`, `ResponseTimePoint`,
 * `UptimeWindows`) so the chart components can be fed directly from the
 * `get-monitor-stats` / `get-public-status-page` action payloads without any
 * remapping. Keep them structurally in sync with the server types.
 */

/** Coarse health of a single timeline bucket. */
export type BucketStatus = "up" | "down" | "degraded" | "no-data";

export interface UptimeWindows {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  uptime90d: number | null;
}

export interface UptimeBucket {
  /** ISO timestamp for the inclusive start of the bucket. */
  start: string;
  /** ISO timestamp for the exclusive end of the bucket. */
  end: string;
  status: BucketStatus;
  /** Uptime percentage in the bucket (null when there were no checks). */
  uptimePct: number | null;
  total: number;
  downCount: number;
  degradedCount: number;
}

export interface ResponseTimePoint {
  /** ISO timestamp for the start of the bucket. */
  bucketStart: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

/** Which uptime windows the stat cards render, in order. */
export type UptimeWindowKey = keyof UptimeWindows;
