export type DataSourceType =
  | "bigquery"
  | "ga4"
  | "amplitude"
  | "first-party"
  | "demo"
  | "prometheus"
  | "program";

export const PANEL_CHART_TYPES = [
  "line",
  "area",
  "bar",
  "combo",
  "metric",
  "table",
  "pie",
  "section",
  "funnel",
  "heatmap",
  "callout",
  "extension",
] as const;

export type ChartType = (typeof PANEL_CHART_TYPES)[number];

export type FilterType =
  | "date"
  | "date-range"
  | "select"
  | "multi-select"
  | "toggle"
  | "text"
  | "toggle-date";

export interface FilterOption {
  value: string;
  label: string;
}

// A named selection of a multi-select filter's option values.
export interface FilterPreset {
  label: string;
  values: string[];
}

export interface DashboardFilter {
  id: string;
  label: string;
  type: FilterType;
  default?: string;
  options?: FilterOption[];
  presets?: FilterPreset[];
  // On a select filter: show a date range only when "custom" is chosen, and
  // clear it when another option is picked (as preset date filters do for
  // "30d"-style options). For selects whose options are periods the SQL
  // resolves itself, such as "this" / "last" quarter.
  customRange?: boolean;
}

export type ColumnFormat =
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "link"
  | "text"
  | "delta";

export interface TableColumnConfig {
  key: string;
  label?: string;
  format?: ColumnFormat;
  linkKey?: string;
  hidden?: boolean;
  width?: number;
}

export interface PivotConfig {
  xKey: string;
  seriesKey: string;
  valueKey: string;
  /** Series values drawn first, in this order; unlisted series follow. */
  seriesOrder?: string[];
}

/**
 * Funnel only: result columns that split each stage's count (`yKey`, the
 * people shown the stage) by what those people did there.
 */
export interface FunnelOutcomesConfig {
  completedKey: string;
  leftKey: string;
  skippedKey?: string;
  /** A boolean column; true marks a stage people may skip. */
  optionalKey?: string;
}

export type DashboardTimeScope =
  | "dashboard"
  | "fixed-window"
  | "cohort-history"
  | "all-time";

export interface PanelEvent {
  /** Calendar date in the event's own time zone, "YYYY-MM-DD". */
  date: string;
  /** Optional 24-hour time of day, "HH:MM". */
  time?: string;
  /** IANA zone for `time`, e.g. "America/New_York"; UTC when omitted. */
  timeZone?: string;
  label: string;
  /** Optional SVG-safe hex color: #RGB, #RGBA, #RRGGBB, or #RRGGBBAA. */
  color?: string;
}

export interface SqlPanelConfig {
  timeScope?: DashboardTimeScope;
  events?: PanelEvent[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  color?: string;
  colors?: string[];
  yFormatter?: "number" | "currency" | "percent";
  rightYKeys?: string[];
  rightYFormatter?: "number" | "currency" | "percent";
  barKeys?: string[];
  seriesLabels?: Record<string, string>;
  description?: string;
  pivot?: PivotConfig;
  funnelOutcomes?: FunnelOutcomesConfig;
  stacked?: boolean;
  legend?: boolean;
  valueLabels?: Record<string, string>;
  sortable?: boolean;
  columns?: TableColumnConfig[];
  limit?: number;
  extensionId?: string;
  extensionSlotId?: string;
  customBlock?: {
    authoredBy: "agent" | "user";
    intent: "one-off";
    scope: "dashboard";
    nativeGapReason:
      | "custom-visualization"
      | "custom-interaction"
      | "custom-layout"
      | "other";
  };
}

export interface SqlPanel {
  id: string;
  title: string;
  sql: string;
  source: DataSourceType;
  chartType: ChartType;
  width: number;
  /** Optional fixed height in 180px units; missing panels keep content height. */
  height?: number;
  columns?: number;
  config?: SqlPanelConfig;
  tab?: string;
}

export interface DashboardCertification {
  status: "certified";
  certifiedAt: string;
  certifiedBy: string;
  certifiedForUpdatedAt: string;
}

export interface SqlDashboardConfig {
  name: string;
  description?: string;
  certification?: DashboardCertification;
  parentId?: string;
  catalog?: {
    templateId?: string;
    templateVersion?: string;
    installedAt?: string;
  };
  demo?: {
    id: string;
    version?: string;
    installedAt?: string;
  };
  filters?: DashboardFilter[];
  variables?: Record<string, string>;
  columns?: number;
  panels: SqlPanel[];
  annotations?: DashboardAnnotations;
  /** Panels the repair already delivered; a removed one stays removed only while this survives whole-config saves. */
  introducedPanels?: string[];
}

/** Dashboard-level settings for key dates and data notes; per-panel `events` stay in panel config. */
export interface DashboardAnnotations {
  /** Key-date sets this dashboard leaves off its charts. Every other set shows on every time chart. */
  hiddenKeyDateSets?: string[];
  /** Data notes this dashboard leaves off one chart each. */
  hiddenDataNotes?: { noteId: string; panelId: string }[];
}

export const MIN_DASHBOARD_COLUMNS = 1;
export const MAX_DASHBOARD_COLUMNS = 6;
export const DEFAULT_DASHBOARD_COLUMNS = 2;
export const MIN_PANEL_HEIGHT = 1;
export const MAX_PANEL_HEIGHT = 6;
export const PANEL_HEIGHT_UNIT_PX = 180;

export function clampDashboardColumns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DASHBOARD_COLUMNS;
  }
  const integer = Math.floor(value);
  if (integer < MIN_DASHBOARD_COLUMNS) return MIN_DASHBOARD_COLUMNS;
  if (integer > MAX_DASHBOARD_COLUMNS) return MAX_DASHBOARD_COLUMNS;
  return integer;
}

export function clampPanelWidth(value: unknown, gridColumns: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const integer = Math.floor(value);
  if (integer < 1) return 1;
  if (integer > gridColumns) return gridColumns;
  return integer;
}

export function clampPanelHeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MIN_PANEL_HEIGHT;
  }
  const integer = Math.floor(value);
  if (integer < MIN_PANEL_HEIGHT) return MIN_PANEL_HEIGHT;
  if (integer > MAX_PANEL_HEIGHT) return MAX_PANEL_HEIGHT;
  return integer;
}

function isPanelRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePanelValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => samePanelValue(value, right[index]))
    );
  }
  if (!isPanelRecord(left) || !isPanelRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && samePanelValue(left[key], right[key]),
    )
  );
}

function mergeEditedRecord(
  edited: Record<string, unknown>,
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current };
  const keys = new Set([...Object.keys(baseline), ...Object.keys(edited)]);
  for (const key of keys) {
    const hadBaseline = Object.prototype.hasOwnProperty.call(baseline, key);
    const hasEdited = Object.prototype.hasOwnProperty.call(edited, key);
    if (
      hadBaseline === hasEdited &&
      samePanelValue(edited[key], baseline[key])
    ) {
      continue;
    }
    if (!hasEdited) {
      delete merged[key];
      continue;
    }
    const editedValue = edited[key];
    const baselineValue = baseline[key];
    const currentValue = merged[key];
    merged[key] =
      isPanelRecord(editedValue) &&
      isPanelRecord(baselineValue) &&
      isPanelRecord(currentValue)
        ? mergeEditedRecord(editedValue, baselineValue, currentValue)
        : editedValue;
  }
  return merged;
}

export function mergeUnchangedPanelFields(
  editedPanel: SqlPanel,
  basePanel: SqlPanel | null,
  currentPanel: SqlPanel | null,
): SqlPanel {
  const merged = { ...editedPanel };
  if (!currentPanel || currentPanel.id !== editedPanel.id) return merged;
  if (!basePanel) {
    merged.width = currentPanel.width;
    if (currentPanel.height === undefined) delete merged.height;
    else merged.height = currentPanel.height;
    if (editedPanel.chartType === "section") delete merged.height;
    return merged;
  }

  const keys = new Set([
    ...Object.keys(basePanel),
    ...Object.keys(editedPanel),
    ...Object.keys(currentPanel),
  ]);
  for (const key of keys) {
    if (key === "config") continue;
    const hasEdited = Object.prototype.hasOwnProperty.call(editedPanel, key);
    const hasBaseline = Object.prototype.hasOwnProperty.call(basePanel, key);
    if (
      hasEdited !== hasBaseline ||
      !samePanelValue(
        editedPanel[key as keyof SqlPanel],
        basePanel[key as keyof SqlPanel],
      )
    ) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(currentPanel, key)) {
      Object.assign(merged, { [key]: currentPanel[key as keyof SqlPanel] });
    } else {
      delete (merged as unknown as Record<string, unknown>)[key];
    }
  }

  const mergedConfig = mergeEditedRecord(
    isPanelRecord(editedPanel.config) ? editedPanel.config : {},
    isPanelRecord(basePanel.config) ? basePanel.config : {},
    isPanelRecord(currentPanel.config) ? currentPanel.config : {},
  );
  if (Object.keys(mergedConfig).length > 0) {
    merged.config = mergedConfig as SqlPanel["config"];
  } else {
    delete merged.config;
  }

  if (editedPanel.chartType === "section") {
    delete merged.height;
  }
  return merged;
}
