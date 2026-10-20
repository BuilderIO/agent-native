export type BucketStatus = "up" | "down" | "degraded" | "no-data";

export interface UptimeWindows {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  uptime90d: number | null;
}

export interface UptimeBucket {
  start: string;
  end: string;
  status: BucketStatus;
  uptimePct: number | null;
  total: number;
  downCount: number;
  degradedCount: number;
}

export interface ResponseTimePoint {
  bucketStart: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

export type UptimeWindowKey = keyof UptimeWindows;
