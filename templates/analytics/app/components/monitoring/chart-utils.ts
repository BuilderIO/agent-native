/**
 * Pure presentation helpers for the reusable uptime charts. Self-contained (no
 * dependency on the in-app monitoring page utils) so these components stay
 * importable from both the authenticated detail view and the public,
 * unauthenticated status page.
 */
import type { BucketStatus } from "./types";

/** Solid fill for a timeline bucket / status dot. Matches the app health palette. */
export function bucketFillClass(status: BucketStatus): string {
  switch (status) {
    case "up":
      return "bg-emerald-500";
    case "down":
      return "bg-red-500";
    case "degraded":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/25";
  }
}

export function bucketTextClass(status: BucketStatus): string {
  switch (status) {
    case "up":
      return "text-emerald-500";
    case "down":
      return "text-red-500";
    case "degraded":
      return "text-amber-500";
    default:
      return "text-muted-foreground";
  }
}

/** Format an uptime percentage with UptimeRobot-style precision. */
export function formatUptimePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  if (pct >= 99.995) return "100%";
  return `${pct.toFixed(pct >= 99.9 ? 3 : pct >= 99 ? 2 : 1)}%`;
}

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded} ms`;
  return `${(rounded / 1000).toFixed(2)} s`;
}

/** Compact date-time label for tooltips/axes (locale-aware, no year). */
export function formatBucketTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Day-only label (used for wide daily uptime timelines). */
export function formatBucketDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Human range like "Feb 3, 2:00 PM – 3:00 PM". */
export function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const startLabel = formatBucketTime(start);
  if (!end) return startLabel;
  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return startLabel;
  const endLabel = endDate.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startLabel} – ${endLabel}`;
}

export function bucketStatusLabel(status: BucketStatus): string {
  switch (status) {
    case "up":
      return "Operational";
    case "down":
      return "Down";
    case "degraded":
      return "Degraded";
    default:
      return "No data";
  }
}
