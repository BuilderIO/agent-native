import type { SqlPanelConfig } from "./types";

export type ChartValueFormatter = NonNullable<SqlPanelConfig["yFormatter"]>;
export type ChartAxisSide = "left" | "right";

const MAX_LABELLED_SERIES_PER_AXIS = 2;
const MAX_AXIS_LABEL_LENGTH = 28;

export interface DualAxisPlan {
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
