import { pivotRows } from "../app/pages/adhoc/sql-dashboard/pivot";
import {
  PANEL_CHART_TYPES,
  type ChartType,
  type SqlPanel,
  type SqlPanelConfig,
} from "../app/pages/adhoc/sql-dashboard/types";
import { normalizeDashboardConfig } from "./dashboard-config-normalization";
import {
  resolveDashboardFunnelRows,
  type DashboardFunnelRows,
} from "./dashboard-funnel";

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
      ),
    expected: "an object with string xKey, seriesKey and valueKey",
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

const MAX_CHART_POINTS = 400;

/** Rows a chart draws: line, area, combo and heatmap keep the newest, the rest the first. */
export function limitChartRows(
  rows: Record<string, unknown>[],
  chartType: ChartType,
): Record<string, unknown>[] {
  if (
    rows.length <= MAX_CHART_POINTS ||
    ![
      "line",
      "area",
      "bar",
      "combo",
      "pie",
      "heatmap",
      "funnel",
      "callout",
    ].includes(chartType)
  ) {
    return rows;
  }
  return chartType !== "line" &&
    chartType !== "area" &&
    chartType !== "combo" &&
    chartType !== "heatmap"
    ? rows.slice(0, MAX_CHART_POINTS)
    : rows.slice(-MAX_CHART_POINTS);
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
  /** The viewer sees "No data": no rows, or a funnel or heatmap that finds nothing to draw. */
  empty: boolean;
  /** Rows that draw something; 0 when `empty`. */
  renderedRowCount: number;
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
  const { xKey, yKeys } = detectKeys(rows, config, pivoted?.seriesKeys);
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
    empty,
    renderedRowCount: empty ? 0 : (funnel?.items.length ?? rows.length),
    funnel,
    heatmap,
    missingKeys,
    ignoredConfig,
  };
}
