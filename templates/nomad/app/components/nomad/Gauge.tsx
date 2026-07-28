import { severityColor } from "@/lib/nomad";

import type { Severity } from "../../../shared/types";

/**
 * Circular day-count gauge (country detail hero). Pure SVG — the ring fills
 * clockwise from 12 o'clock proportionally to pct.
 */
export function Gauge({
  pct,
  severity,
  centerTop,
  centerBottom,
}: {
  pct: number;
  severity: Severity;
  centerTop: string;
  centerBottom: string;
}) {
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative h-[180px] w-[180px]">
      <svg
        width="180"
        height="180"
        viewBox="0 0 180 180"
        className="-rotate-90"
      >
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          className="nomad-track"
          stroke="hsl(var(--muted-foreground) / 0.15)"
          strokeWidth="14"
        />
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke={severityColor(severity)}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-4xl font-semibold text-foreground">
          {centerTop}
        </div>
        <div className="text-xs text-muted-foreground">{centerBottom}</div>
      </div>
    </div>
  );
}
