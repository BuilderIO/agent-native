import type { SqlPanelConfig } from "../app/pages/adhoc/sql-dashboard/types";
import { formatDuration } from "./format-duration";

/**
 * How big the change is, without a sign (the direction carries it):
 * - `none`: it rounds away to nothing.
 * - `percent`: the change relative to the previous value, as "71" for 71%.
 * - `points`: percentage points between two percents, as "0.3" for 0.3 pts.
 * - `value`: the change itself in the tile's own format, for durations and
 *   for a previous value of 0, where a relative change has no meaning.
 */
export type MetricChange =
  | { kind: "none" }
  | { kind: "percent" | "points" | "value"; amount: string };

export interface MetricComparison {
  previous: number;
  direction: "up" | "down" | "flat";
  /** Whether the change is good news, per the panel's `better` direction. */
  tone: "good" | "bad" | "neutral";
  change: MetricChange;
  /** The row's or the config's name for the previous period, if any. */
  period: string | null;
}

export const DEFAULT_PREVIOUS_KEY = "previous_value";
export const DEFAULT_PERIOD_KEY = "period";

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

// One decimal below 10, whole numbers from 10 up, as durations read.
function rounded(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

function amountText(value: number): string {
  return rounded(value).toLocaleString("en-US");
}

// Percent tiles show values from -1 to 1 as fractions (0.25 reads 25%) and
// larger ones as percents already, so the points between two of them follow
// the same rule.
function asPercent(value: number): number {
  return value <= 1 && value >= -1 ? value * 100 : value;
}

/**
 * A metric tile's change from the period before, or null when there is
 * nothing to compare: no `comparison` config, a value that isn't a number or
 * is shown through a value label, or a row without a numeric previous value.
 * A tile that sums several rows compares with the sum of their previous
 * values, so every row needs one.
 */
export function metricComparison({
  rows,
  current,
  config,
  formatValue,
}: {
  rows: Record<string, unknown>[];
  current: unknown;
  config:
    | Pick<SqlPanelConfig, "comparison" | "yFormatter" | "valueLabels">
    | undefined;
  /** Shows a change in the tile's own format, for the `value` kind. */
  formatValue: (value: number) => string;
}): MetricComparison | null {
  const comparison = config?.comparison;
  if (!comparison || rows.length === 0) return null;
  if (config.valueLabels?.[String(current)] !== undefined) return null;
  const currentValue = finiteNumber(current);
  if (currentValue === null) return null;

  const previousKey = comparison.previousKey ?? DEFAULT_PREVIOUS_KEY;
  let previous = 0;
  for (const row of rows) {
    const value = finiteNumber(row[previousKey]);
    if (value === null) return null;
    previous += value;
  }

  const periodRaw = rows[0][comparison.periodKey ?? DEFAULT_PERIOD_KEY];
  const period =
    (typeof periodRaw === "string" && periodRaw.trim()) ||
    comparison.label?.trim() ||
    null;

  const format = config.yFormatter;
  // Percents compare in the points they show, so the sign comes from those.
  const delta =
    format === "percent"
      ? asPercent(currentValue) - asPercent(previous)
      : currentValue - previous;
  let change: MetricChange;
  if (format === "percent") {
    const points = Math.abs(delta);
    change =
      rounded(points) === 0
        ? { kind: "none" }
        : { kind: "points", amount: amountText(points) };
  } else if (format === "duration") {
    const seconds = Math.abs(delta);
    change =
      rounded(seconds) === 0
        ? { kind: "none" }
        : { kind: "value", amount: formatDuration(seconds) };
  } else if (previous === 0) {
    change =
      delta === 0
        ? { kind: "none" }
        : { kind: "value", amount: formatValue(Math.abs(delta)) };
  } else {
    const percent = Math.abs(delta / previous) * 100;
    change =
      rounded(percent) === 0
        ? { kind: "none" }
        : { kind: "percent", amount: amountText(percent) };
  }

  const direction = change.kind === "none" ? "flat" : delta > 0 ? "up" : "down";
  const better = comparison.better ?? "higher";
  const tone =
    direction === "flat" || better === "neither"
      ? "neutral"
      : (direction === "up") === (better === "higher")
        ? "good"
        : "bad";
  return { previous, direction, tone, change, period };
}
