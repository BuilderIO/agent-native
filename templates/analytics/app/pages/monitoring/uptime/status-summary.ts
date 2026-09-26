import type { MonitorStatus } from "./types";

export type MonitorHealthTone = "up" | "down" | "degraded" | "neutral";

export function statusToneOf(status: MonitorStatus | null): MonitorHealthTone {
  switch (status) {
    case "up":
      return "up";
    case "down":
    case "error":
      return "down";
    case "degraded":
      return "degraded";
    default:
      return "neutral";
  }
}

export interface MonitorStatusSummary {
  total: number;
  up: number;
  down: number;
  degraded: number;
  pending: number;
  overallUptimePct: number | null;
  openIncidents: number;
  overall: MonitorHealthTone;
}

interface MonitorLike {
  id: string;
  lastStatus: MonitorStatus | null;
}

interface StatsLike {
  windows: { uptime24h: number | null };
}

export function summarizeMonitors(
  monitors: MonitorLike[],
  statsById?: Map<string, StatsLike>,
): MonitorStatusSummary {
  let up = 0;
  let down = 0;
  let degraded = 0;
  let pending = 0;
  const pcts: number[] = [];
  for (const monitor of monitors) {
    const tone = statusToneOf(monitor.lastStatus);
    if (tone === "up") up++;
    else if (tone === "down") down++;
    else if (tone === "degraded") degraded++;
    else pending++;
    const pct = statsById?.get(monitor.id)?.windows.uptime24h;
    if (pct != null && Number.isFinite(pct)) pcts.push(pct);
  }
  const overallUptimePct = pcts.length
    ? pcts.reduce((sum, value) => sum + value, 0) / pcts.length
    : null;
  const overall: MonitorHealthTone =
    down > 0 ? "down" : degraded > 0 ? "degraded" : up > 0 ? "up" : "neutral";
  return {
    total: monitors.length,
    up,
    down,
    degraded,
    pending,
    overallUptimePct,
    openIncidents: down + degraded,
    overall,
  };
}
