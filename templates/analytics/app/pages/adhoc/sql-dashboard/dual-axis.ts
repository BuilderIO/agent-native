import type { SqlPanelConfig } from "./types";

export type ChartValueFormatter = NonNullable<SqlPanelConfig["yFormatter"]>;
export type ChartAxisSide = "left" | "right";

/**
 * Past this many series an auto-derived axis label is more noise than help, so
 * the axis renders with ticks only.
 */
const MAX_LABELLED_SERIES_PER_AXIS = 2;
const MAX_AXIS_LABEL_LENGTH = 28;

export interface DualAxisPlan {
  /** True only when both axes end up with at least one plotted series. */
  enabled: boolean;
  leftKeys: string[];
  rightKeys: string[];
  leftFormatter?: ChartValueFormatter;
  rightFormatter?: ChartValueFormatter;
  leftLabel?: string;
  rightLabel?: string;
  sideFor: (key: string) => ChartAxisSide;
  formatterFor: (key: string) => ChartValueFormatter | undefined;
}

function axisLabel(
  keys: string[],
  formatSeriesName: (key: string) => string,
): string | undefined {
  if (keys.length === 0 || keys.length > MAX_LABELLED_SERIES_PER_AXIS) {
    return undefined;
  }
  const label = keys.map(formatSeriesName).join(", ");
  return label.length > MAX_AXIS_LABEL_LENGTH
    ? `${label.slice(0, MAX_AXIS_LABEL_LENGTH - 3)}...`
    : label;
}

/**
 * Splits plotted series across a left and right y-axis. A configuration that
 * would leave one axis empty — every series on the right, or `rightYKeys`
 * naming columns the query never returned — collapses back to a single axis so
 * the chart keeps one honest scale instead of silently dropping series.
 * `SqlChart` surfaces the unmatched names through its config warning.
 */
export function resolveDualAxis(
  yKeys: string[],
  config?: SqlPanelConfig,
  formatSeriesName: (key: string) => string = (key) => key,
): DualAxisPlan {
  const configured = new Set(config?.rightYKeys ?? []);
  const rightKeys = yKeys.filter((key) => configured.has(key));
  const leftKeys = yKeys.filter((key) => !configured.has(key));
  const enabled = rightKeys.length > 0 && leftKeys.length > 0;
  const leftFormatter = config?.yFormatter;
  const rightFormatter = enabled
    ? (config?.rightYFormatter ?? config?.yFormatter)
    : leftFormatter;

  const isRight = (key: string) => enabled && configured.has(key);

  return {
    enabled,
    leftKeys: enabled ? leftKeys : yKeys,
    rightKeys: enabled ? rightKeys : [],
    leftFormatter,
    rightFormatter,
    leftLabel: enabled ? axisLabel(leftKeys, formatSeriesName) : undefined,
    rightLabel: enabled ? axisLabel(rightKeys, formatSeriesName) : undefined,
    sideFor: (key) => (isRight(key) ? "right" : "left"),
    formatterFor: (key) => (isRight(key) ? rightFormatter : leftFormatter),
  };
}
