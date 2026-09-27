import type { BucketStatus } from "./types";

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

export function formatBucketDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

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
