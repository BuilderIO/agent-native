import { pivotRows } from "../app/pages/adhoc/sql-dashboard/pivot";
import {
  PANEL_CHART_TYPES,
  type ChartType,
  type SqlPanel,
  type SqlPanelConfig,
} from "../app/pages/adhoc/sql-dashboard/types";

export { PANEL_CHART_TYPES };

export const LEGACY_CHART_TYPE_ALIASES: Record<string, ChartType> = {
  "stacked-bar": "bar",
  "stacked-area": "area",
};

export const PANEL_TOP_LEVEL_KEYS = [
  "id",
  "title",
  "sql",
  "source",
  "chartType",
  "width",
  "columns",
  "config",
  "tab",
] as const satisfies readonly (keyof SqlPanel)[];

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

const ROLLING_AVERAGE_HINT =
  "there is no native rolling or moving-average option. Add a window-function column to the panel SQL (for example AVG(value) OVER (ORDER BY week ROWS BETWEEN 3 PRECEDING AND CURRENT ROW) AS value_4wk_avg) and list it in config.yKeys. If config.pivot is set it drops extra columns, so remove pivot or emit the average as an extra series row.";

export interface ConfigKeyIssue {
  panelId?: string;
  path: string;
  key: string;
  kind:
    | "unknown-key"
    | "misplaced-key"
    | "unknown-chart-type"
    | "wrong-chart-type";
  message: string;
  didYouMean?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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
      ? panel.title.trim().slice(0, 60)
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
      message: `${label} config.${key} is not a renderer option: ${ROLLING_AVERAGE_HINT}`,
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

/**
 * Keys the renderer would silently ignore. With `baseline`, only keys whose
 * value differs from the baseline panel are reported, so a legacy stray key
 * never blocks an unrelated edit.
 */
export function unknownPanelConfigKeys(
  panel: Record<string, unknown>,
  baseline?: Record<string, unknown>,
): ConfigKeyIssue[] {
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
      const onlyFor = CONFIG_KEY_INFO[key].onlyFor;
      if (
        onlyFor &&
        resolvedChartType &&
        !onlyFor.includes(resolvedChartType as ChartType) &&
        (changedConfig(key, panel.config) || changedTopLevel("chartType"))
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
  const baseById = new Map<string, Record<string, unknown>>();
  for (const panel of Array.isArray(base?.panels) ? base.panels : []) {
    if (isRecord(panel) && typeof panel.id === "string") {
      baseById.set(panel.id, panel);
    }
  }
  const issues: ConfigKeyIssue[] = [];
  for (const panel of Array.isArray(next.panels) ? next.panels : []) {
    if (!isRecord(panel) || typeof panel.id !== "string") continue;
    if (!touchedIds.has(panel.id)) continue;
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

  const yKeys = (config?.yKeys ?? (config?.yKey ? [config.yKey] : [])).filter(
    (key) => colSet.has(key),
  );
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
    for (const key of config?.yKeys ?? []) check(key, raw);
    for (const key of config?.rightYKeys ?? []) check(key, raw);
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

  // yKey beside pivot names the value column in every catalog pivot panel, so
  // only a yKeys list the pivot drops is a requested series.
  if (config?.pivot && pivotSeries && config.yKeys?.length) {
    const differs =
      config.yKeys.length !== pivotSeries.length ||
      config.yKeys.some((key) => !pivotSeries.includes(key));
    if (differs) {
      ignored.push({
        key: "yKeys",
        reason:
          "config.pivot supplies the series, so yKeys is ignored and any other SQL result column is dropped. Remove config.pivot to plot wide-format columns.",
      });
    }
  }

  const plotted = new Set(yKeys);
  const notPlotted = (config?.rightYKeys ?? []).filter(
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
  const right = new Set(config?.rightYKeys ?? []);
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

  if (config?.barKeys?.length) {
    if (panel.chartType !== "combo") {
      ignored.push({
        key: "barKeys",
        reason: 'barKeys only applies to chartType "combo".',
      });
    } else {
      const notSeries = config.barKeys.filter((key) => !plotted.has(key));
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

export interface PanelRenderPlan {
  /** Post-pivot rows; the array the renderer tests for "No data". */
  rows: Record<string, unknown>[];
  rawColumns: string[];
  xKey: string;
  yKeys: string[];
  empty: boolean;
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
  const empty = rows.length === 0;

  // No raw rows means no columns to bind against: unknown, not missing.
  const missingKeys =
    rawRows.length === 0
      ? []
      : collectMissingKeys(
          rawColumns,
          empty ? rawColumns : Object.keys(rows[0]),
          panel,
        );
  const ignoredConfig = empty
    ? []
    : collectIgnoredConfig(panel, yKeys, pivoted?.seriesKeys, missingKeys);

  return { rows, rawColumns, xKey, yKeys, empty, missingKeys, ignoredConfig };
}
