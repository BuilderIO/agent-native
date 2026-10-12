import { pivotRows } from "../app/pages/adhoc/sql-dashboard/pivot";
import {
  PANEL_CHART_TYPES,
  type ChartType,
  type SqlPanel,
  type SqlPanelConfig,
} from "../app/pages/adhoc/sql-dashboard/types";
import { axisDirection, isDateAxis } from "./chart-axis-labels";
import { normalizeDashboardConfig } from "./dashboard-config-normalization";
import {
  resolveDashboardFunnelRows,
  type DashboardFunnelRows,
} from "./dashboard-funnel";
import {
  NON_APP_SERIES_COLORS,
  UNKNOWN_APP_COLOR,
  appSeriesColor,
  isUnknownApp,
} from "./tokens/app-series-colors";

export { PANEL_CHART_TYPES };

export const LEGACY_CHART_TYPE_ALIASES: Record<string, ChartType> = {
  "stacked-bar": "bar",
  "stacked-area": "area",
};

// `satisfies Record<keyof SqlPanel, ...>` fails the build when SqlPanel gains a
// field the contract has not registered, as PANEL_CONFIG_KEYS does for config.
const PANEL_TOP_LEVEL_KEY_SET = {
  id: true,
  title: true,
  sql: true,
  source: true,
  chartType: true,
  width: true,
  columns: true,
  config: true,
  tab: true,
} satisfies Record<keyof SqlPanel, true>;

export const PANEL_TOP_LEVEL_KEYS = Object.keys(
  PANEL_TOP_LEVEL_KEY_SET,
) as (keyof SqlPanel)[];

interface PanelConfigKeyInfo {
  onlyFor?: readonly ChartType[];
}

// `satisfies Record<keyof SqlPanelConfig, ...>` fails the build when
// SqlPanelConfig gains a key the renderer contract has not registered.
export const PANEL_CONFIG_KEYS = {
  timeScope: {},
  xKey: {},
  yKey: {},
  yKeys: {},
  color: { onlyFor: ["heatmap"] },
  colors: {},
  yFormatter: {},
  rightYKeys: {},
  rightYFormatter: {},
  barKeys: { onlyFor: ["combo"] },
  seriesLabels: {},
  description: {},
  pivot: {},
  stacked: {},
  legend: {},
  valueLabels: {},
  sortable: {},
  columns: {},
  limit: {},
  extensionId: {},
  extensionSlotId: {},
  customBlock: {},
} satisfies Record<keyof SqlPanelConfig, PanelConfigKeyInfo>;

const CONFIG_KEY_INFO: Record<string, PanelConfigKeyInfo> = PANEL_CONFIG_KEYS;
const HONORED_CONFIG_KEYS = Object.keys(PANEL_CONFIG_KEYS).join(", ");

const CONFIG_KEY_ALIASES: Record<string, string> = {
  yAxis: "yFormatter",
  "yAxis.format": "yFormatter",
  format: "yFormatter",
  y: "yKey",
  x: "xKey",
  lines: "yKeys",
  series: "yKeys",
  secondaryAxis: "rightYKeys",
  y2Keys: "rightYKeys",
  rightAxis: "rightYKeys",
  stack: "stacked",
  showLegend: "legend",
};

const ROLLING_WINDOW = "ORDER BY week ROWS BETWEEN 3 PRECEDING AND CURRENT ROW";

// First-party SQL runs under an approved-function allowlist that has no AVG
// (server/lib/first-party-analytics-sql-policy.ts), so the average there is
// SUM over COUNT on the same window.
function rollingAverageHint(source: unknown): string {
  const column =
    source === "first-party"
      ? `SUM(value) OVER (${ROLLING_WINDOW}) * 1.0 / COUNT(value) OVER (${ROLLING_WINDOW}) AS value_4wk_avg; AVG is not an approved function in first-party SQL`
      : `AVG(value) OVER (${ROLLING_WINDOW}) AS value_4wk_avg`;
  return `there is no native rolling or moving-average option. Add a window-function column to the panel SQL (for example ${column}) and list it in config.yKeys. If config.pivot is set it drops extra columns, so remove pivot or emit the average as an extra series row.`;
}

export interface ConfigKeyIssue {
  panelId?: string;
  path: string;
  key: string;
  kind:
    | "unknown-key"
    | "misplaced-key"
    | "unknown-chart-type"
    | "wrong-chart-type"
    | "invalid-value"
    | "duplicate-panel-id";
  message: string;
  didYouMean?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * At most the first `max` UTF-16 units of `text`. A cut inside an emoji drops
 * the half, because a provider API rejects a request holding a lone surrogate.
 */
export function clipHead(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

export function stableStringify(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item) =>
      isRecord(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : item,
    ) ?? "undefined"
  );
}

export function panelLabel(
  panel: Record<string, unknown>,
  index?: number,
): string {
  const id =
    typeof panel.id === "string" && panel.id.trim() ? panel.id.trim() : "";
  const title =
    typeof panel.title === "string" && panel.title.trim()
      ? clipHead(panel.title.trim(), 60)
      : "";
  const base = id ? `panel "${id}"` : `panel[${index ?? "?"}]`;
  return title ? `${base} ("${title}")` : base;
}

export function editDistance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
}

function closestMatch(
  key: string,
  candidates: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(key, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function isKnownChartType(chartType: string): boolean {
  return (
    (PANEL_CHART_TYPES as readonly string[]).includes(chartType) ||
    hasOwn(LEGACY_CHART_TYPE_ALIASES, chartType)
  );
}

function unknownConfigKeyIssue(
  panel: Record<string, unknown>,
  key: string,
): ConfigKeyIssue {
  const label = panelLabel(panel);
  const base = {
    panelId: typeof panel.id === "string" ? panel.id : undefined,
    path: `config.${key}`,
    key,
    kind: "unknown-key" as const,
  };
  if (
    /^(moving|rolling)(avg|average|mean)?$/i.test(key.replace(/[-_ ]/g, ""))
  ) {
    return {
      ...base,
      message: `${label} config.${key} is not a renderer option: ${rollingAverageHint(panel.source)}`,
    };
  }
  const didYouMean = hasOwn(CONFIG_KEY_ALIASES, key)
    ? CONFIG_KEY_ALIASES[key]
    : closestMatch(key, Object.keys(PANEL_CONFIG_KEYS));
  return {
    ...base,
    didYouMean,
    message:
      `${label} config.${key} is not a renderer option and would be silently ignored.` +
      (didYouMean ? ` Did you mean '${didYouMean}'?` : "") +
      ` Honored config keys: ${HONORED_CONFIG_KEYS}.`,
  };
}

interface ConfigValueShape {
  valid: (value: unknown) => boolean;
  expected: string;
}

const STRING_ARRAY_SHAPE: ConfigValueShape = {
  valid: (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "string"),
  expected: "an array of result column names",
};

const CONFIG_VALUE_SHAPES: Record<string, ConfigValueShape> = {
  yKeys: STRING_ARRAY_SHAPE,
  rightYKeys: STRING_ARRAY_SHAPE,
  barKeys: STRING_ARRAY_SHAPE,
  pivot: {
    valid: (value) =>
      isRecord(value) &&
      ["xKey", "seriesKey", "valueKey"].every(
        (key) => typeof value[key] === "string" && value[key] !== "",
      ) &&
      (value.seriesOrder === undefined ||
        STRING_ARRAY_SHAPE.valid(value.seriesOrder)),
    expected:
      "an object with string xKey, seriesKey and valueKey, and an optional seriesOrder array of series values",
  },
};

// The store promotes legacy panel fields written under config on every read
// and write, so judge the panel the way it will be saved.
function storedPanel(panel: Record<string, unknown>): Record<string, unknown> {
  return normalizeDashboardConfig({ panels: [panel] }).panels[0];
}

export function duplicatePanelIds(panels: readonly unknown[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const panel of panels) {
    if (!isRecord(panel) || typeof panel.id !== "string") continue;
    (seen.has(panel.id) ? duplicates : seen).add(panel.id);
  }
  return duplicates;
}

export function duplicatePanelIdIssue(
  panel: Record<string, unknown>,
): ConfigKeyIssue {
  return {
    panelId: typeof panel.id === "string" ? panel.id : undefined,
    path: "id",
    key: "id",
    kind: "duplicate-panel-id",
    message: `${panelLabel(panel)} shares its id with another panel: this dashboard has duplicate panel ids, and edits reach only the first copy. Rename one copy first (update-dashboard op replace /panels/<index>/id), then retry.`,
  };
}

/**
 * Keys the renderer would silently ignore. With `baseline`, only keys whose
 * value differs from the baseline panel are reported, so a legacy stray key
 * never blocks an unrelated edit.
 */
export function unknownPanelConfigKeys(
  rawPanel: Record<string, unknown>,
  rawBaseline?: Record<string, unknown>,
): ConfigKeyIssue[] {
  const panel = storedPanel(rawPanel);
  const baseline = rawBaseline && storedPanel(rawBaseline);
  const issues: ConfigKeyIssue[] = [];
  const label = panelLabel(panel);
  const panelId = typeof panel.id === "string" ? panel.id : undefined;
  const baselineConfig = isRecord(baseline?.config) ? baseline.config : {};
  const changedTopLevel = (key: string) =>
    !baseline || stableStringify(baseline[key]) !== stableStringify(panel[key]);
  const changedConfig = (key: string, config: Record<string, unknown>) =>
    !baseline ||
    stableStringify(baselineConfig[key]) !== stableStringify(config[key]);

  const chartType = typeof panel.chartType === "string" ? panel.chartType : "";
  const resolvedChartType = hasOwn(LEGACY_CHART_TYPE_ALIASES, chartType)
    ? LEGACY_CHART_TYPE_ALIASES[chartType]
    : chartType;
  if (
    chartType &&
    !isKnownChartType(chartType) &&
    changedTopLevel("chartType")
  ) {
    const didYouMean = closestMatch(chartType, PANEL_CHART_TYPES);
    issues.push({
      panelId,
      path: "chartType",
      key: "chartType",
      kind: "unknown-chart-type",
      didYouMean,
      message:
        `${label} chartType "${chartType}" is not a chart type.` +
        (didYouMean ? ` Did you mean '${didYouMean}'?` : "") +
        ` Chart types: ${PANEL_CHART_TYPES.join(", ")}.`,
    });
  }

  for (const [key, value] of Object.entries(panel)) {
    if (value == null || !changedTopLevel(key)) continue;
    if ((PANEL_TOP_LEVEL_KEYS as readonly string[]).includes(key)) continue;
    const misplaced = hasOwn(PANEL_CONFIG_KEYS, key);
    issues.push({
      panelId,
      path: key,
      key,
      kind: misplaced ? "misplaced-key" : "unknown-key",
      message: misplaced
        ? `${label} has "${key}" at the panel level, but it is a renderer option and the renderer ignores it there. Put it under config (config.${key}).`
        : `${label} has an unknown panel field "${key}". Panel fields: ${PANEL_TOP_LEVEL_KEYS.join(", ")}; renderer options belong in config.`,
    });
  }

  if (isRecord(panel.config)) {
    for (const [key, value] of Object.entries(panel.config)) {
      if (value == null) continue;
      if (!hasOwn(CONFIG_KEY_INFO, key)) {
        if (changedConfig(key, panel.config)) {
          issues.push(unknownConfigKeyIssue(panel, key));
        }
        continue;
      }
      const shape = CONFIG_VALUE_SHAPES[key];
      if (shape && !shape.valid(value) && changedConfig(key, panel.config)) {
        issues.push({
          panelId,
          path: `config.${key}`,
          key,
          kind: "invalid-value",
          message: `${label} config.${key} must be ${shape.expected}, not ${clipHead(stableStringify(value), 60)}.`,
        });
      }
      const onlyFor = CONFIG_KEY_INFO[key].onlyFor;
      if (
        onlyFor &&
        resolvedChartType &&
        !onlyFor.includes(resolvedChartType as ChartType) &&
        changedConfig(key, panel.config)
      ) {
        issues.push({
          panelId,
          path: `config.${key}`,
          key,
          kind: "wrong-chart-type",
          message:
            key === "color"
              ? `${label} config.color is the heatmap row-dimension column name, not a color, and this panel is "${chartType}". Use config.colors (an array of colors) to restyle series.`
              : `${label} config.${key} only applies to chartType "${onlyFor.join('" or "')}", and this panel is "${chartType}".`,
        });
      }
    }
  }
  return issues;
}

/**
 * Diff-based ratchet over a dashboard config: only touched panels, and only
 * keys whose value changed versus `base`.
 */
export function validatePanelContract(
  base: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
  touchedIds: ReadonlySet<string>,
): ConfigKeyIssue[] {
  // First match wins, like the edit API that picks the panel.
  const baseById = new Map<string, Record<string, unknown>>();
  for (const panel of Array.isArray(base?.panels) ? base.panels : []) {
    if (isRecord(panel) && typeof panel.id === "string") {
      if (!baseById.has(panel.id)) baseById.set(panel.id, panel);
    }
  }
  const nextPanels = Array.isArray(next.panels) ? next.panels : [];
  const duplicates = duplicatePanelIds(nextPanels);
  const issues: ConfigKeyIssue[] = [];
  const reportedDuplicates = new Set<string>();
  for (const panel of nextPanels) {
    if (!isRecord(panel) || typeof panel.id !== "string") continue;
    if (!touchedIds.has(panel.id)) continue;
    if (duplicates.has(panel.id)) {
      if (!reportedDuplicates.has(panel.id)) {
        reportedDuplicates.add(panel.id);
        issues.push(duplicatePanelIdIssue(panel));
      }
      continue;
    }
    issues.push(...unknownPanelConfigKeys(panel, baseById.get(panel.id)));
  }
  return issues;
}

export function isNumericLikeValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  );
}

function detectKeys(
  rows: Record<string, unknown>[],
  config?: SqlPanel["config"],
  forcedYKeys?: string[],
): { xKey: string; yKeys: string[] } {
  if (rows.length === 0) return { xKey: "", yKeys: [] };

  const cols = Object.keys(rows[0]);
  const colSet = new Set(cols);
  const sample = rows[0] as Record<string, unknown>;

  let xKey = config?.xKey && colSet.has(config.xKey) ? config.xKey : "";
  if (!xKey) {
    xKey =
      cols.find((c) => {
        const v = sample[c];
        if (typeof v === "string" && v.length >= 8) {
          const d = new Date(v);
          return !isNaN(d.getTime());
        }
        return false;
      }) ||
      cols.find((c) => typeof sample[c] === "string") ||
      cols[0];
  }

  if (forcedYKeys && forcedYKeys.length) {
    return { xKey, yKeys: forcedYKeys.filter((key) => colSet.has(key)) };
  }

  const configured = Array.isArray(config?.yKeys)
    ? config.yKeys
    : config?.yKey
      ? [config.yKey]
      : [];
  const yKeys = configured.filter((key) => colSet.has(key));
  if (yKeys.length === 0) {
    for (const c of cols) {
      if (c === xKey) continue;
      if (isNumericLikeValue(sample[c])) yKeys.push(c);
    }
  }
  if (yKeys.length === 0 && cols.length > 1) {
    yKeys.push(cols.find((c) => c !== xKey) || cols[1]);
  }

  return { xKey, yKeys };
}

type RenderPanel = Pick<SqlPanel, "chartType" | "config">;

// A model-written config can hold a string where a list belongs. The renderer
// tolerates that, so planning must not throw on it.
function keyList(value: unknown): string[] {
  return Array.isArray(value) ? value : [];
}

/**
 * `boundColumns` are the columns the renderer reads after pivoting; null when
 * unknown (schema-only checks of a pivoted panel).
 */
function collectMissingKeys(
  rawColumns: string[],
  boundColumns: string[] | null,
  panel: RenderPanel,
): string[] {
  const config = panel.config;
  const raw = new Set(rawColumns);
  const bound = boundColumns ? new Set(boundColumns) : null;
  const missing = new Set<string>();
  const check = (key: string | undefined, columns: Set<string> | null) => {
    if (key && columns && !columns.has(key)) missing.add(key);
  };

  check(config?.xKey, bound);
  if (config?.pivot) {
    check(config.pivot.xKey, raw);
    check(config.pivot.seriesKey, raw);
    check(config.pivot.valueKey, raw);
  } else {
    check(config?.yKey, raw);
    for (const key of keyList(config?.yKeys)) check(key, raw);
    for (const key of keyList(config?.rightYKeys)) check(key, raw);
  }
  for (const col of Array.isArray(config?.columns) ? config.columns : []) {
    check(col?.key, bound);
    check(col?.linkKey, bound);
  }
  if (panel.chartType === "heatmap") check(config?.color, bound);
  return Array.from(missing);
}

export function missingKeysFromColumns(
  columns: string[],
  panel: RenderPanel,
): string[] {
  return collectMissingKeys(
    columns,
    panel.config?.pivot ? null : columns,
    panel,
  );
}

function collectIgnoredConfig(
  panel: RenderPanel,
  yKeys: string[],
  seriesKeys: string[] | undefined,
  missingKeys: string[],
): { key: string; reason: string }[] {
  const config = panel.config;
  const ignored: { key: string; reason: string }[] = [];
  const pivotSeries = seriesKeys?.length ? seriesKeys : null;
  const configuredYKeys = keyList(config?.yKeys);
  const rightYKeys = keyList(config?.rightYKeys);
  const barKeys = keyList(config?.barKeys);

  // yKey beside pivot names the value column in every catalog pivot panel, so
  // only a yKeys list the pivot drops is a requested series.
  if (config?.pivot && pivotSeries && configuredYKeys.length) {
    const differs =
      configuredYKeys.length !== pivotSeries.length ||
      configuredYKeys.some((key) => !pivotSeries.includes(key));
    if (differs) {
      ignored.push({
        key: "yKeys",
        reason:
          "config.pivot supplies the series, so yKeys is ignored and any other SQL result column is dropped. Remove config.pivot to plot wide-format columns.",
      });
    }
  }

  const plotted = new Set(yKeys);
  const notPlotted = rightYKeys.filter(
    (key) => !plotted.has(key) && !missingKeys.includes(key),
  );
  if (notPlotted.length > 0) {
    ignored.push({
      key: "rightYKeys",
      reason: `${notPlotted.join(", ")} ${notPlotted.length === 1 ? "is" : "are"} not among the plotted series, so the right axis ignores ${notPlotted.length === 1 ? "it" : "them"}.`,
    });
  }
  const usesDualAxis = ["line", "area", "bar", "combo"].includes(
    LEGACY_CHART_TYPE_ALIASES[panel.chartType] ?? panel.chartType,
  );
  const right = new Set(rightYKeys);
  if (
    usesDualAxis &&
    yKeys.length > 0 &&
    right.size > 0 &&
    yKeys.every((key) => right.has(key))
  ) {
    ignored.push({
      key: "rightYKeys",
      reason:
        "every plotted series is on the right axis, so dual-axis is disabled. Keep at least one series on the left axis.",
    });
  }

  if (barKeys.length) {
    if (panel.chartType !== "combo") {
      ignored.push({
        key: "barKeys",
        reason: 'barKeys only applies to chartType "combo".',
      });
    } else {
      const notSeries = barKeys.filter((key) => !plotted.has(key));
      if (notSeries.length > 0) {
        ignored.push({
          key: "barKeys",
          reason: `${notSeries.join(", ")} ${notSeries.length === 1 ? "is" : "are"} not among the plotted series (yKeys).`,
        });
      }
    }
  }
  return ignored;
}

export const MAX_CHART_POINTS = 400;

const POINT_LIMITED_CHART_TYPES: readonly string[] = [
  "line",
  "area",
  "bar",
  "combo",
  "pie",
  "heatmap",
  "funnel",
  "callout",
];
const LAST_POINT_CHART_TYPES: readonly string[] = [
  "line",
  "area",
  "combo",
  "heatmap",
];

/** Points a chart drops past MAX_CHART_POINTS; the viewer must be told. */
export interface ChartPointLimit {
  shown: number;
  total: number;
  keeps: "newest" | "last" | "first";
}

/**
 * Line, area, combo and heatmap charts keep their last rows, and bar charts
 * their first. Only an `xKey` of dates in date order makes the kept rows the
 * newest, for a bar chart too; otherwise the note must not claim recency.
 */
export function chartPointLimit(
  rows: readonly Record<string, unknown>[],
  chartType: string,
  xKey?: string,
): ChartPointLimit | null {
  const type = LEGACY_CHART_TYPE_ALIASES[chartType] ?? chartType;
  if (
    rows.length <= MAX_CHART_POINTS ||
    !POINT_LIMITED_CHART_TYPES.includes(type)
  ) {
    return null;
  }
  const xValues = xKey ? rows.map((row) => row[xKey]) : [];
  const keepsLast = LAST_POINT_CHART_TYPES.includes(type);
  const datesInOrder = isDateAxis(xValues) && axisDirection(xValues) !== null;
  return {
    shown: MAX_CHART_POINTS,
    total: rows.length,
    keeps:
      datesInOrder && (keepsLast || type === "bar")
        ? "newest"
        : keepsLast
          ? "last"
          : "first",
  };
}

/**
 * Rows a chart draws, per `chartPointLimit`. Newest is the end of the rows
 * unless `xKey` shows they run newest-first (ORDER BY date DESC).
 */
export function limitChartRows<T extends Record<string, unknown>>(
  rows: T[],
  chartType: string,
  xKey?: string,
): T[] {
  const limit = chartPointLimit(rows, chartType, xKey);
  if (!limit) return rows;
  const newestFirst =
    limit.keeps === "newest" &&
    !!xKey &&
    axisDirection(rows.map((row) => row[xKey])) === "descending";
  return limit.keeps === "first" || newestFirst
    ? rows.slice(0, limit.shown)
    : rows.slice(-limit.shown);
}

const STACKABLE_CHART_TYPES: readonly string[] = ["bar", "area"];

// "Other" and "unknown" buckets go on top of a stack, whatever their size.
const CATCH_ALL_SERIES = /^(other|others|unknown|not set|none|n\/a)$/;

function isCatchAllSeries(key: string): boolean {
  return CATCH_ALL_SERIES.test(
    key
      .trim()
      .replace(/^[([{]\s*|\s*[)\]}]$/g, "")
      .toLowerCase(),
  );
}

function seriesTotal(rows: Record<string, unknown>[], key: string): number {
  let total = 0;
  for (const row of rows) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * Each drawn series' slot in `config.colors`: `config.pivot.seriesOrder` first,
 * then result order. Never draw order: authors give colors a meaning (green
 * for positive), so ranking a stack or a reordered result must not hand one
 * series another's color.
 */
export function seriesColorSlots(
  orderedKeys: readonly string[],
  resultKeys: readonly string[],
  panel: RenderPanel,
): number[] {
  const listed = Array.from(new Set(keyList(panel.config?.pivot?.seriesOrder)));
  const listedSet = new Set(listed);
  const slots = [...listed, ...resultKeys.filter((key) => !listedSet.has(key))];
  return orderedKeys.map((key) => slots.indexOf(key));
}

// The pivot columns that hold an Agent-Native app key. Series names alone can't
// say so: `chat` or `content` is also a channel or a site section.
const APP_PIVOT_COLUMNS = new Set(["app", "template"]);

function isSplitByApp(
  panel: RenderPanel,
  appColors: readonly (string | undefined)[],
): boolean {
  const column = panel.config?.pivot?.seriesKey;
  return (
    typeof column === "string" &&
    APP_PIVOT_COLUMNS.has(column.trim().toLowerCase()) &&
    appColors.some((color) => color !== undefined)
  );
}

/**
 * The color each of `orderedKeys` draws in. With `config.colors`, `palette` is
 * those colors and every series takes its slot. Otherwise a chart pivoted by an
 * app column that holds an Agent-Native app draws apps in their fixed colors
 * and every other series muted; any other chart takes `palette` by slot.
 */
export function resolveSeriesColors(
  orderedKeys: readonly string[],
  slots: readonly number[],
  panel: RenderPanel,
  palette: readonly string[],
): string[] {
  const appColors = orderedKeys.map(appSeriesColor);
  if (
    keyList(panel.config?.colors).length > 0 ||
    !isSplitByApp(panel, appColors)
  ) {
    return slots.map((slot) => palette[slot % palette.length]);
  }
  const otherSlots = slots.filter(
    (_, index) => !appColors[index] && !isUnknownApp(orderedKeys[index]),
  );
  return orderedKeys.map((key, index) => {
    const app = appColors[index];
    if (app) return app;
    if (isUnknownApp(key)) return UNKNOWN_APP_COLOR;
    const rank = otherSlots.filter((slot) => slot < slots[index]).length;
    return NON_APP_SERIES_COLORS[rank % NON_APP_SERIES_COLORS.length];
  });
}

/**
 * The order a panel draws its series in; the first is the bottom of a stack.
 * `config.pivot.seriesOrder` and a listed `config.yKeys` are the author's
 * order. Otherwise a stacked bar or area chart puts the largest total first and
 * an "Other"/"unknown" bucket last, and any other chart keeps result order.
 */
export function orderPanelSeries(
  rows: Record<string, unknown>[],
  yKeys: string[],
  panel: RenderPanel,
): string[] {
  const config = panel.config;
  if (!config?.pivot && keyList(config?.yKeys).length > 0) return yKeys;

  const present = new Set(yKeys);
  const listed = Array.from(
    new Set(
      keyList(config?.pivot?.seriesOrder).filter((key) => present.has(key)),
    ),
  );
  const listedSet = new Set(listed);
  const rest = yKeys.filter((key) => !listedSet.has(key));
  const chartType =
    LEGACY_CHART_TYPE_ALIASES[panel.chartType] ?? panel.chartType;
  if (
    config?.stacked !== true ||
    !STACKABLE_CHART_TYPES.includes(chartType) ||
    rest.length < 2
  ) {
    return [...listed, ...rest];
  }

  const totals = new Map(rest.map((key) => [key, seriesTotal(rows, key)]));
  const ranked = rest
    .map((key, index) => ({ key, index }))
    .sort((a, b) => {
      const catchAll =
        Number(isCatchAllSeries(a.key)) - Number(isCatchAllSeries(b.key));
      if (catchAll !== 0) return catchAll;
      const diff = (totals.get(b.key) ?? 0) - (totals.get(a.key) ?? 0);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ key }) => key);
  return [...listed, ...ranked];
}

export interface HeatmapKeys {
  xKey: string;
  valueKey: string;
  rowKey: string;
}

/** The columns the heatmap reads; no value column means it draws nothing. */
export function resolveHeatmapKeys(
  rows: Record<string, unknown>[],
  config?: SqlPanel["config"],
): HeatmapKeys {
  if (rows.length === 0) return { xKey: "", valueKey: "", rowKey: "" };
  const cols = Object.keys(rows[0]);
  const sample = rows[0];
  const xKey =
    config?.xKey || cols.find((c) => typeof sample[c] === "string") || cols[0];
  const valueKey =
    config?.yKey ||
    cols.find((c) => c !== xKey && typeof sample[c] === "number") ||
    cols[1] ||
    "";
  const rowKey =
    config?.color ||
    cols.find(
      (c) => c !== xKey && c !== valueKey && typeof sample[c] === "string",
    ) ||
    "";
  return { xKey, valueKey, rowKey };
}

export interface PanelRenderPlan {
  /** Post-pivot rows; the array the renderer tests for "No data". */
  rows: Record<string, unknown>[];
  rawColumns: string[];
  xKey: string;
  yKeys: string[];
  /** Each of `yKeys`' color slot; `resolveSeriesColors` turns them into colors. */
  colorSlots: number[];
  /** The viewer sees "No data": no rows, or a funnel or heatmap that finds nothing to draw. */
  empty: boolean;
  /** Rows that draw something; 0 when `empty`. */
  renderedRowCount: number;
  /** Set when the chart draws only MAX_CHART_POINTS of `rows`. */
  pointLimit: ChartPointLimit | null;
  /** Set for a funnel panel; the renderer draws exactly these items. */
  funnel: DashboardFunnelRows | null;
  /** Set for a heatmap panel; the renderer reads exactly these columns. */
  heatmap: HeatmapKeys | null;
  missingKeys: string[];
  ignoredConfig: { key: string; reason: string }[];
}

export function planPanelRender(
  rawRows: Record<string, unknown>[],
  panel: RenderPanel,
  opts?: { timeRange?: number },
): PanelRenderPlan {
  const config = panel.config;
  const rawColumns = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
  const pivoted =
    config?.pivot && rawRows.length
      ? pivotRows(rawRows, config.pivot, {
          fillDateGaps: panel.chartType !== "bar",
          timeRange: opts?.timeRange,
        })
      : null;
  const rows = pivoted ? pivoted.rows : rawRows;
  const detected = detectKeys(rows, config, pivoted?.seriesKeys);
  const xKey = detected.xKey;
  const yKeys = orderPanelSeries(
    limitChartRows(rows, panel.chartType, xKey),
    detected.yKeys,
    panel,
  );
  const noRows = rows.length === 0;
  const funnel =
    panel.chartType === "funnel"
      ? resolveDashboardFunnelRows(
          limitChartRows(rows, panel.chartType),
          config?.xKey,
          config?.yKey,
        )
      : null;
  const heatmap =
    panel.chartType === "heatmap"
      ? resolveHeatmapKeys(limitChartRows(rows, panel.chartType), config)
      : null;
  const empty =
    noRows ||
    (funnel !== null && funnel.items.length === 0) ||
    (heatmap !== null && !heatmap.valueKey);

  // No raw rows means no columns to bind against: unknown, not missing.
  const missingKeys =
    rawRows.length === 0
      ? []
      : collectMissingKeys(
          rawColumns,
          noRows ? rawColumns : Object.keys(rows[0]),
          panel,
        );
  const ignoredConfig = noRows
    ? []
    : collectIgnoredConfig(panel, yKeys, pivoted?.seriesKeys, missingKeys);

  return {
    rows,
    rawColumns,
    xKey,
    yKeys,
    colorSlots: seriesColorSlots(yKeys, detected.yKeys, panel),
    empty,
    renderedRowCount: empty ? 0 : (funnel?.items.length ?? rows.length),
    pointLimit: empty ? null : chartPointLimit(rows, panel.chartType, xKey),
    funnel,
    heatmap,
    missingKeys,
    ignoredConfig,
  };
}
