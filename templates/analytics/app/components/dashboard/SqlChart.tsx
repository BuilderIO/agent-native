import { useT } from "@agent-native/core/client";
import { EmbeddedExtension } from "@agent-native/core/client/extensions";
import {
  IconArrowsSort,
  IconSortAscending,
  IconSortDescending,
  IconChevronLeft,
  IconChevronRight,
  IconAlertTriangle,
  IconInfoCircle,
  IconTrendingUp,
  IconTrendingDown,
} from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
import { useSqlQuery } from "@/lib/sql-query";
import { serializePanelSql } from "@/pages/adhoc/sql-dashboard/panel-sql";
import { pivotRows } from "@/pages/adhoc/sql-dashboard/pivot";
import type {
  SqlPanel,
  ChartType,
  TableColumnConfig,
  ColumnFormat,
} from "@/pages/adhoc/sql-dashboard/types";

const DEFAULT_COLORS = [
  "var(--brand-blue)",
  "var(--brand-teal)",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
];

const CHART_TOOLTIP_WRAPPER_STYLE: CSSProperties = {
  zIndex: 60,
  pointerEvents: "none",
};

const PORTAL_GUTTER_PADDING = 12;
const PORTAL_CURSOR_OFFSET = 24;
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const CHART_TOOLTIP_PROPS = {
  allowEscapeViewBox: { x: true, y: true },
  wrapperStyle: CHART_TOOLTIP_WRAPPER_STYLE,
} as const;

const BAR_TOOLTIP_CURSOR_PROPS = {
  fill: "hsl(var(--muted))",
  fillOpacity: 0.32,
  stroke: "hsl(var(--border))",
  strokeOpacity: 0.5,
  strokeWidth: 1,
  rx: 4,
  ry: 4,
} as const;

const CHART_LEGEND_WRAPPER_STYLE: CSSProperties = {
  fontSize: 11,
  paddingTop: 8,
};

const CHART_LEGEND_PROPS = {
  iconSize: 8,
  wrapperStyle: CHART_LEGEND_WRAPPER_STYLE,
} as const;

const PARTIAL_DAY_TIME_ZONE = "America/Los_Angeles";
const PARTIAL_DAY_DASH = "3 5";
const PARTIAL_DAY_KEY_PREFIX = "__sql_chart_partial_day";

function formatYValue(
  value: number,
  formatter?: "number" | "currency" | "percent",
): string {
  if (formatter === "currency") return `$${value.toLocaleString()}`;
  if (formatter === "percent") {
    // SQL typically returns rate as 0..1
    const pct = value <= 1 && value >= -1 ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
  }
  return value.toLocaleString();
}

/**
 * Format a single metric value for display. Coerces Postgres numeric/bigint
 * columns (returned as strings, e.g. a rate of "0.00000000000000000000") to a
 * number so the formatter applies — SQLite returns JS numbers, so this only
 * bites on Postgres/Neon, where the raw high-scale decimal would otherwise be
 * dumped verbatim. A configured `valueLabels` mapping wins; a non-numeric
 * string falls through unformatted.
 */
export function formatMetricValue(
  raw: unknown,
  formatter?: "number" | "currency" | "percent",
  valueLabels?: Record<string, string>,
): string {
  const valueLabel = valueLabels?.[String(raw)];
  if (valueLabel !== undefined) return valueLabel;
  const numericRaw =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" &&
          raw.trim() !== "" &&
          Number.isFinite(Number(raw))
        ? Number(raw)
        : null;
  return numericRaw !== null
    ? formatYValue(numericRaw, formatter)
    : String(raw ?? "-");
}

function parsePrometheusSeriesLabel(label: string): {
  metric: string;
  labels: Record<string, string>;
} {
  const trimmed = label.trim();
  const match = /^(.*?)\{(.*)\}$/.exec(trimmed);
  if (!match) return { metric: trimmed, labels: {} };

  const labels: Record<string, string> = {};
  const body = match[2];
  const re = /([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return { metric: match[1], labels };
}

function compactGrafanaTarget(value: string): string {
  const withoutDevicePrefix = value.replace(/^device\s+-\s+/i, "");
  const beforeExplanation = withoutDevicePrefix.split(/\s+[–-]\s+/)[0];
  return beforeExplanation.trim() || value;
}

function truncateLabel(value: string, max = 48): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function parseCalendarDate(value: string): Date | null {
  const normalized = /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toSqlChartDateKey(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : sqlChartLocalDateKey(parsed);
}

export function sqlChartLocalDateKey(
  date = new Date(),
  timeZone = PARTIAL_DAY_TIME_ZONE,
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {}
  return date.toISOString().slice(0, 10);
}

export interface SplitTimeSeries {
  key: string;
  solidKey: string;
  partialKey: string | null;
}

export function splitCurrentDayTimeSeriesRows(
  rows: Record<string, unknown>[],
  xKey: string,
  yKeys: string[],
  todayKey = sqlChartLocalDateKey(),
): { rows: Record<string, unknown>[]; series: SplitTimeSeries[] } {
  const todayIndexes = rows
    .map((row, index) => ({ index, dateKey: toSqlChartDateKey(row[xKey]) }))
    .filter((entry) => entry.dateKey === todayKey)
    .map((entry) => entry.index);
  const firstTodayIndex = todayIndexes[0] ?? -1;

  if (firstTodayIndex <= 0 || yKeys.length === 0) {
    return {
      rows,
      series: yKeys.map((key) => ({ key, solidKey: key, partialKey: null })),
    };
  }

  const todaySet = new Set(todayIndexes);
  const previousIndex = firstTodayIndex - 1;
  const series = yKeys.map((key, index) => ({
    key,
    solidKey: `${PARTIAL_DAY_KEY_PREFIX}_${index}_solid`,
    partialKey: `${PARTIAL_DAY_KEY_PREFIX}_${index}_partial`,
  }));
  const splitRows = rows.map((row, index) => {
    const next = { ...row };
    const isToday = todaySet.has(index);
    const isPartialSegmentStart = index === previousIndex;
    for (const item of series) {
      next[item.solidKey] = isToday ? null : row[item.key];
      next[item.partialKey] =
        isToday || isPartialSegmentStart ? row[item.key] : null;
    }
    return next;
  });

  return { rows: splitRows, series };
}

export function shouldSplitCurrentDayTimeSeries(
  panel: Pick<SqlPanel, "source">,
  xKey: string,
): boolean {
  if (panel.source === "prometheus") return false;

  const normalizedKey = xKey.trim().toLowerCase();
  if (normalizedKey === "timestamp" || normalizedKey.endsWith("_timestamp")) {
    return false;
  }

  return (
    normalizedKey === "date" ||
    normalizedKey === "day" ||
    normalizedKey.endsWith("_date") ||
    normalizedKey.endsWith("_day")
  );
}

function formatSeriesLabel(value: string): string {
  const { metric, labels } = parsePrometheusSeriesLabel(value);
  const target =
    typeof labels.grafana_target === "string"
      ? compactGrafanaTarget(labels.grafana_target)
      : "";

  if (target) {
    if (labels.device) return truncateLabel(`${labels.device} ${target}`);
    if (labels.mountpoint)
      return truncateLabel(`${labels.mountpoint} ${target}`);
    if (labels.cpu) return truncateLabel(`cpu ${labels.cpu} ${target}`);
    if (labels.state) return truncateLabel(`${labels.state} ${target}`);
    if (labels.chip_name) return truncateLabel(`${labels.chip_name} ${target}`);
    if (labels.sensor) return truncateLabel(`${labels.sensor} ${target}`);
    return truncateLabel(target);
  }

  const preferred = [
    "device",
    "mountpoint",
    "fstype",
    "cpu",
    "mode",
    "state",
    "collector",
    "name",
    "route",
    "status",
    "phase",
    "dependency",
    "type",
    "quantile",
    "le",
  ];
  const parts = preferred
    .filter((key) => labels[key])
    .map((key) => `${key}=${labels[key]}`);

  if (parts.length) {
    const prefix = metric ? `${metric} ` : "";
    return truncateLabel(`${prefix}${parts.slice(0, 2).join(" ")}`);
  }

  return truncateLabel(metric || value);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function usesPrometheusPresentation(panel: SqlPanel): boolean {
  return panel.source === "prometheus" || panel.source === "demo";
}

function formatSeriesLabelForPanel(panel: SqlPanel, value: string): string {
  return usesPrometheusPresentation(panel) ? formatSeriesLabel(value) : value;
}

function formatXLabel(value: string, panel: SqlPanel): string {
  try {
    const s = String(value);
    const d = parseCalendarDate(s);
    if (d && s.length >= 8) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  } catch {}
  return formatSeriesLabelForPanel(panel, String(value));
}

function shouldShowLegend(panel: SqlPanel, seriesCount: number): boolean {
  return panel.config?.legend !== false && seriesCount > 0;
}

function numericTooltipValue(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
}

function tooltipItemName(item: {
  dataKey?: string | number;
  name?: string | number;
}): string {
  return String(item.name ?? item.dataKey ?? "");
}

export function sortTooltipPayloadItems<
  T extends {
    dataKey?: string | number;
    name?: string | number;
    value?: unknown;
  },
>(items: T[]): T[] {
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff =
        numericTooltipValue(b.item.value) - numericTooltipValue(a.item.value);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
  const seen = new Set<string>();
  return sorted.filter((item) => {
    const name = tooltipItemName(item);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function useSeriesVisibility(keys: string[]): {
  hiddenKeys: Set<string>;
  visibleKeys: string[];
  toggleSeries: (key: string) => void;
} {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setHiddenKeys((prev) => {
      const next = new Set(
        Array.from(prev).filter((key) => keys.includes(key)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [keys]);

  const visibleKeys = useMemo(
    () => keys.filter((key) => !hiddenKeys.has(key)),
    [hiddenKeys, keys],
  );

  const toggleSeries = useCallback(
    (key: string) => {
      setHiddenKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
          return next;
        }
        const visibleCount = keys.filter((k) => !next.has(k)).length;
        if (visibleCount <= 1) return prev;
        next.add(key);
        return next;
      });
    },
    [keys],
  );

  return { hiddenKeys, visibleKeys, toggleSeries };
}

function SeriesLegend({
  keys,
  colors,
  panel,
  hiddenKeys,
  onToggleKey,
}: {
  keys: string[];
  colors: string[];
  panel: SqlPanel;
  hiddenKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
}) {
  if (!shouldShowLegend(panel, keys.length)) return null;

  return (
    <div className="mt-2 max-h-16 overflow-y-auto overflow-x-hidden pr-1 text-[11px] leading-4 text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {keys.map((key, i) => {
          const hidden = hiddenKeys?.has(key) ?? false;
          const label = formatSeriesLabelForPanel(panel, key);
          const color = colors[i % colors.length];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={!hidden}
              className={`inline-flex max-w-[14rem] items-center gap-1.5 rounded-sm text-left transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                hidden ? "opacity-35" : "opacity-100"
              } ${onToggleKey ? "cursor-pointer" : "cursor-default"}`}
              title={label}
              onClick={() => onToggleKey?.(key)}
            >
              <span className="relative h-2.5 w-3 shrink-0">
                <span
                  className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2"
                  style={{ backgroundColor: color }}
                />
                <span
                  className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ backgroundColor: color }}
                />
              </span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// When a chart renders inside the full-screen modal it should grow to fill the
// available space rather than the fixed 250px card height. ChartFrame reads
// this via context so we avoid threading a prop through every renderer
// (line/area/bar/pie all share ChartFrame).
const ChartFillHeightContext = createContext(false);

export function ChartFillHeight({ children }: { children: ReactNode }) {
  return (
    <ChartFillHeightContext.Provider value={true}>
      {children}
    </ChartFillHeightContext.Provider>
  );
}

function ChartFrame({
  panel,
  legendKeys,
  colors,
  hiddenKeys,
  onToggleLegendKey,
  showCustomLegend = false,
  children,
}: {
  panel: SqlPanel;
  legendKeys: string[];
  colors: string[];
  hiddenKeys?: Set<string>;
  onToggleLegendKey?: (key: string) => void;
  showCustomLegend?: boolean;
  children: ReactNode;
}) {
  const fill = useContext(ChartFillHeightContext);
  const chartHeight = fill ? "h-full min-h-[250px]" : "h-[250px]";

  const renderLegend = showCustomLegend || usesPrometheusPresentation(panel);

  if (!renderLegend) {
    return (
      <div className={`${chartHeight} w-full overflow-visible`}>{children}</div>
    );
  }

  return (
    <div
      className={`flex w-full flex-col overflow-hidden ${fill ? "h-full" : ""}`}
    >
      <div
        className={`${chartHeight} w-full overflow-visible ${fill ? "flex-1" : ""}`}
      >
        {children}
      </div>
      <SeriesLegend
        keys={legendKeys}
        colors={colors}
        panel={panel}
        hiddenKeys={hiddenKeys}
        onToggleKey={onToggleLegendKey}
      />
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  seriesNameFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{
    color?: string;
    dataKey?: string | number;
    name?: string | number;
    value?: unknown;
  }>;
  label?: unknown;
  labelFormatter?: (value: string) => string;
  seriesNameFormatter?: (value: string) => string;
  valueFormatter?: (value: number) => string;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [portalPosition, setPortalPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const items = useMemo(
    () =>
      sortTooltipPayloadItems(
        payload?.filter((item) => item.value != null && item.value !== "") ??
          [],
      ),
    [payload],
  );
  const portalVisible = portalPosition !== null;
  const clearPortalPosition = useCallback(
    () => setPortalPosition((prev) => (prev === null ? prev : null)),
    [],
  );

  const labelText =
    label == null
      ? ""
      : labelFormatter
        ? labelFormatter(String(label))
        : String(label);

  useBrowserLayoutEffect(() => {
    if (!active || items.length === 0 || typeof window === "undefined") {
      clearPortalPosition();
      return;
    }

    const anchor = anchorRef.current;
    const wrapper = anchor?.parentElement;
    if (!anchor || !wrapper) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      if (!(wrapper as HTMLElement).style.transform) return;

      const anchorRect = anchor.getBoundingClientRect();
      const portalRect = portalRef.current?.getBoundingClientRect();
      const width = portalRect?.width || anchorRect.width;
      const height = portalRect?.height || anchorRect.height;
      if (width === 0 || height === 0) return;

      const sidebar = document.querySelector(".agent-sidebar-panel");
      const sidebarRect = sidebar?.getBoundingClientRect();
      const rightLimit =
        sidebarRect && sidebarRect.width > 0 && sidebarRect.left > 0
          ? sidebarRect.left - PORTAL_GUTTER_PADDING
          : window.innerWidth - PORTAL_GUTTER_PADDING;
      const bottomLimit = window.innerHeight - PORTAL_GUTTER_PADDING;

      let left = anchorRect.left;
      let top = anchorRect.top;

      if (left + width > rightLimit) {
        left = anchorRect.left - width - PORTAL_CURSOR_OFFSET;
      }
      left = Math.max(
        PORTAL_GUTTER_PADDING,
        Math.min(left, rightLimit - width),
      );

      if (top + height > bottomLimit) {
        top = bottomLimit - height;
      }
      top = Math.max(PORTAL_GUTTER_PADDING, top);

      setPortalPosition((prev) =>
        prev &&
        Math.abs(prev.left - left) < 0.5 &&
        Math.abs(prev.top - top) < 0.5
          ? prev
          : { left, top },
      );
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    schedule();

    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(wrapper, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizeObserver?.observe(anchor);
    if (portalRef.current) resizeObserver?.observe(portalRef.current);

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [active, clearPortalPosition, items.length, portalVisible]);

  if (!active || items.length === 0) return null;

  const tooltip = (
    <div className="min-w-40 max-w-[280px] rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground shadow-lg">
      {labelText && (
        <div className="mb-1.5 truncate font-medium text-foreground">
          {labelText}
        </div>
      )}
      <div className="space-y-1">
        {items.map((item) => {
          const raw = item.value;
          const numeric = typeof raw === "number" ? raw : Number(raw);
          const value =
            Number.isFinite(numeric) && valueFormatter
              ? valueFormatter(numeric)
              : String(raw ?? "");
          const name = String(item.name ?? item.dataKey ?? "");
          return (
            <div key={name} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color ?? "currentColor" }}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {seriesNameFormatter ? seriesNameFormatter(name) : name}
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <div ref={anchorRef} aria-hidden="true" className="invisible">
        {tooltip}
      </div>
      {portalPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={portalRef}
              role="tooltip"
              style={{
                position: "fixed",
                left: portalPosition.left,
                top: portalPosition.top,
                zIndex: 1000,
                pointerEvents: "none",
              }}
            >
              {tooltip}
            </div>,
            document.body,
          )
        : null}
    </>
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

  // Find the x-axis: prefer a date-like or string column
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

  // Pivoted data: caller already knows the series keys
  if (forcedYKeys && forcedYKeys.length) {
    return { xKey, yKeys: forcedYKeys.filter((key) => colSet.has(key)) };
  }

  // Y keys: all numeric columns that aren't the x-axis
  const yKeys = (config?.yKeys ?? (config?.yKey ? [config.yKey] : [])).filter(
    (key) => colSet.has(key),
  );
  if (yKeys.length === 0) {
    for (const c of cols) {
      if (c === xKey) continue;
      if (typeof sample[c] === "number") yKeys.push(c);
    }
  }
  if (yKeys.length === 0 && cols.length > 1) {
    yKeys.push(cols.find((c) => c !== xKey) || cols[1]);
  }

  return { xKey, yKeys };
}

function configuredKeysMissingFromRows(
  rows: Record<string, unknown>[],
  panel: SqlPanel,
): string[] {
  if (rows.length === 0) return [];
  const rowKeys = new Set(Object.keys(rows[0]));
  const missing = new Set<string>();
  const config = panel.config;
  if (config?.xKey && !rowKeys.has(config.xKey)) missing.add(config.xKey);

  // Pivoted charts turn the configured value column into one column per
  // discovered series. After that transform, yKey/yKeys are no longer active
  // output columns, so do not warn that the original value column is absent.
  if (!config?.pivot) {
    if (config?.yKey && !rowKeys.has(config.yKey)) missing.add(config.yKey);
    for (const key of config?.yKeys ?? []) {
      if (!rowKeys.has(key)) missing.add(key);
    }
  }

  for (const col of config?.columns ?? []) {
    if (!rowKeys.has(col.key)) missing.add(col.key);
    if (col.linkKey && !rowKeys.has(col.linkKey)) missing.add(col.linkKey);
  }
  return Array.from(missing);
}

function ConfigWarning({ keys }: { keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
      <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>Ignored missing result columns: {keys.join(", ")}</span>
    </div>
  );
}

interface SqlChartProps {
  panel: SqlPanel;
  /** SQL with dashboard variables already interpolated. Falls back to panel.sql. */
  resolvedSql?: string;
  className?: string;
  loadData?: boolean;
  onExportCsvChange?: (handler: (() => void) | null) => void;
}

export function SqlChart({
  panel,
  resolvedSql,
  loadData = true,
  onExportCsvChange,
}: SqlChartProps) {
  const t = useT();
  // Hooks must be called unconditionally before any early return.
  const isSection = panel.chartType === "section";
  const isExtension = panel.chartType === "extension";
  // Sections are pure layout and extensions render their own iframe — neither
  // runs the SQL pipeline.
  const shouldQuery = !isSection && !isExtension && loadData;
  const sql = serializePanelSql(resolvedSql ?? panel.sql);
  const {
    data: result,
    isLoading,
    error: queryError,
  } = useSqlQuery(
    ["sql-chart", panel.id, sql, panel.source],
    sql,
    panel.source,
    // Skip the query for section panels — they are pure layout with no data.
    { enabled: shouldQuery },
  );

  const rawRows = result?.rows ?? [];
  const queryErrorMessage =
    queryError instanceof Error
      ? queryError.message
      : queryError
        ? String(queryError)
        : undefined;
  const error =
    rawRows.length === 0 ? (result?.error ?? queryErrorMessage) : undefined;

  const { rows, forcedYKeys } = useMemo(() => {
    if (panel.config?.pivot && rawRows.length) {
      const pivoted = pivotRows(rawRows, panel.config.pivot);
      return { rows: pivoted.rows, forcedYKeys: pivoted.seriesKeys };
    }
    return { rows: rawRows, forcedYKeys: undefined };
  }, [rawRows, panel.config?.pivot]);

  const { xKey, yKeys } = useMemo(
    () => detectKeys(rows, panel.config, forcedYKeys),
    [rows, panel.config, forcedYKeys],
  );

  // Section panels are pure layout — no query, no chart. Render a header with
  // optional description and skip the SQL pipeline entirely.
  if (isSection) {
    return (
      <div className="px-1 py-2">
        {panel.config?.description && (
          <p className="text-sm text-muted-foreground">
            {panel.config.description}
          </p>
        )}
      </div>
    );
  }

  // Extension panels render a sandboxed extension iframe instead of querying a
  // data source. The extension id lives in config.extensionId.
  if (isExtension) {
    const extensionId = panel.config?.extensionId;
    if (!extensionId) {
      return (
        <div className="flex flex-1 items-center justify-center px-4 py-8 min-h-[120px]">
          <p className="text-sm text-muted-foreground text-center">
            {t("sqlDashboard.extensionMissingId")}
          </p>
        </div>
      );
    }
    return (
      <DashboardExtensionPanel extensionId={extensionId} panelId={panel.id} />
    );
  }
  const colors = panel.config?.colors || DEFAULT_COLORS;
  const yFormatter = panel.config?.yFormatter;

  const isMetric = panel.chartType === "metric";
  const placeholderMinH = isMetric ? "min-h-12" : "min-h-[250px]";
  const placeholderPadY = isMetric ? "py-2" : "py-8";

  if (!loadData || isLoading) {
    return (
      <Skeleton
        data-dashboard-report-loading="true"
        className={`w-full flex-1 ${placeholderMinH}`}
      />
    );
  }

  if (error) {
    return (
      <div
        className={`flex flex-1 items-center justify-center px-4 ${placeholderPadY} ${placeholderMinH}`}
      >
        <p className="text-sm text-red-400 text-center break-all">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className={`flex flex-1 items-center justify-center ${placeholderPadY} ${placeholderMinH}`}
      >
        <p className="text-sm text-muted-foreground text-center">
          {t("common.noData")}
        </p>
      </div>
    );
  }

  // Legacy normalization: older saved dashboards may still have stacked-*
  // chart types. Render them unstacked rather than silently blank.
  const chartType: ChartType =
    (panel.chartType as string) === "stacked-bar"
      ? "bar"
      : (panel.chartType as string) === "stacked-area"
        ? "area"
        : panel.chartType;
  const missingConfigKeys = configuredKeysMissingFromRows(rows, panel);
  const withConfigWarning = (node: ReactNode) =>
    missingConfigKeys.length > 0 ? (
      <div className="space-y-2">
        <ConfigWarning keys={missingConfigKeys} />
        {node}
      </div>
    ) : (
      node
    );

  if (chartType === "metric") {
    return withConfigWarning(<MetricRenderer rows={rows} panel={panel} />);
  }

  if (chartType === "table") {
    return withConfigWarning(
      <TableRenderer
        rows={rows}
        panel={panel}
        onExportCsvChange={onExportCsvChange}
      />,
    );
  }

  if (chartType === "pie") {
    return withConfigWarning(
      <PieRenderer
        rows={rows}
        xKey={xKey}
        yKey={yKeys[0]}
        colors={colors}
        panel={panel}
      />,
    );
  }

  if (chartType === "bar") {
    return withConfigWarning(
      <BarRenderer
        rows={rows}
        xKey={xKey}
        yKeys={yKeys}
        colors={colors}
        yFormatter={yFormatter}
        stacked={panel.config?.stacked === true}
        panel={panel}
      />,
    );
  }

  if (chartType === "heatmap") {
    return withConfigWarning(<HeatmapRenderer rows={rows} panel={panel} />);
  }

  if (chartType === "callout") {
    return withConfigWarning(<CalloutRenderer rows={rows} />);
  }

  if (chartType !== "line" && chartType !== "area") {
    return withConfigWarning(<TableRenderer rows={rows} panel={panel} />);
  }

  return withConfigWarning(
    <TimeSeriesRenderer
      rows={rows}
      xKey={xKey}
      yKeys={yKeys}
      colors={colors}
      yFormatter={yFormatter}
      chartType={chartType}
      stacked={panel.config?.stacked === true}
      panel={panel}
    />,
  );
}

function DashboardExtensionPanel({
  extensionId,
  panelId,
}: {
  extensionId: string;
  panelId: string;
}) {
  const t = useT();
  // Hold the report-readiness marker until the extension iframe paints so
  // dashboard report screenshots don't capture a blank extension panel.
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // Embedding never grants access to the extension itself (same model as
  // ExtensionSlots). A viewer with dashboard-only access who can't see the
  // referenced extension gets a clear message instead of a blank panel.
  if (unavailable) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 min-h-[120px]">
        <p className="text-sm text-muted-foreground text-center">
          {t("sqlDashboard.extensionUnavailable")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="w-full"
      data-dashboard-report-loading={ready ? undefined : "true"}
    >
      <EmbeddedExtension
        extensionId={extensionId}
        slotId={`dashboard-panel-${panelId}`}
        className="w-full"
        // Intentional for v1: extension panels are standalone widgets and do not
        // receive the dashboard's filters/variables/date range as `context`.
        initialHeight={180}
        onReady={() => setReady(true)}
        onUnavailable={() => {
          // Clear the report-loading gate so report capture doesn't hang.
          setReady(true);
          setUnavailable(true);
        }}
      />
    </div>
  );
}

function MetricRenderer({
  rows,
  panel,
}: {
  rows: Record<string, unknown>[];
  panel: SqlPanel;
}) {
  const row = rows[0];
  const cols = Object.keys(row);
  const valueCol =
    panel.config?.yKey ||
    cols.find((c) => typeof row[c] === "number") ||
    cols[0];

  let raw: unknown;
  if (rows.length > 1 && typeof row[valueCol] === "number") {
    raw = rows.reduce((sum, r) => sum + (Number(r[valueCol]) || 0), 0);
  } else {
    raw = row[valueCol];
  }
  const value = formatMetricValue(
    raw,
    panel.config?.yFormatter,
    panel.config?.valueLabels,
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-2 text-center">
      <div className="text-3xl font-bold">{value}</div>
      {panel.config?.description && (
        <p className="text-xs text-muted-foreground mt-1">
          {panel.config.description}
        </p>
      )}
    </div>
  );
}

function formatCell(value: unknown, format: ColumnFormat | undefined): string {
  if (value == null) return "";
  if (format === "number" && typeof value === "number") {
    return value.toLocaleString();
  }
  if (format === "currency" && typeof value === "number") {
    return `$${value.toLocaleString()}`;
  }
  if (format === "percent" && typeof value === "number") {
    const pct = value <= 1 && value >= -1 ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
  }
  if (format === "delta" && typeof value === "number") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }
  if (format === "date") {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return String(value);
}

export function safeDashboardLinkHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href) return null;
  if (href.startsWith("//")) return null;

  try {
    const parsed = href.startsWith("/")
      ? new URL(href, "https://agent-native.local")
      : new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? href
      : null;
  } catch {
    return null;
  }
}

function renderDeltaCell(value: unknown): ReactNode {
  if (value == null || typeof value !== "number" || Number.isNaN(value)) {
    return <span className="text-muted-foreground">-</span>;
  }
  const sign = value > 0 ? "+" : "";
  const text = `${sign}${value.toFixed(1)}%`;
  const isPositive = value > 0;
  const isNegative = value < 0;
  const colorClass = isPositive
    ? "text-emerald-500"
    : isNegative
      ? "text-red-500"
      : "text-muted-foreground";
  const Arrow = isPositive
    ? IconTrendingUp
    : isNegative
      ? IconTrendingDown
      : null;
  const critical = Math.abs(value) > 30;
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 ${colorClass}`}
    >
      {Arrow && <Arrow className="h-3.5 w-3.5" />}
      <span>{text}</span>
      {critical && <IconAlertTriangle className="h-3.5 w-3.5" />}
    </span>
  );
}

function rowString(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function sessionReplayHref(row: Record<string, unknown>): string | null {
  const recordingId = rowString(row, [
    "recording_id",
    "session_recording_id",
    "sessionRecordingId",
  ]);
  if (recordingId) return `/sessions/${encodeURIComponent(recordingId)}`;

  const sessionId = rowString(row, ["session_id", "sessionId"]);
  if (!sessionId) return null;
  const params = new URLSearchParams({ range: "all", q: sessionId });
  return `/sessions?${params.toString()}`;
}

function isSessionColumn(key: string): boolean {
  return key === "session_id" || key === "sessionId";
}

function TableRenderer({
  rows,
  panel,
  onExportCsvChange,
}: {
  rows: Record<string, unknown>[];
  panel: SqlPanel;
  onExportCsvChange?: (handler: (() => void) | null) => void;
}) {
  const t = useT();
  const config = panel.config;
  const sortable = config?.sortable !== false; // default on

  // Resolve column list: explicit config wins, otherwise infer from first row
  const columns = useMemo<TableColumnConfig[]>(() => {
    const rowKeys = new Set(Object.keys(rows[0] ?? {}));
    if (config?.columns?.length) {
      const configured = config.columns.filter(
        (c) => !c.hidden && rowKeys.has(c.key),
      );
      if (configured.length > 0) return configured;
    }
    return Object.keys(rows[0]).map((key) => ({ key }));
  }, [config?.columns, rows]);

  // Cap the dataset at `config.limit` before sorting/paginating. Saved
  // dashboards rely on this to keep long-tailed queries snappy — sorting
  // 50k rows client-side to page through the first 50 wastes a lot of work.
  const limitedRows = useMemo(() => {
    const limit = config?.limit;
    return limit != null && rows.length > limit ? rows.slice(0, limit) : rows;
  }, [rows, config?.limit]);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const sortedRows = useMemo(() => {
    if (!sortable || !sortKey) return limitedRows;
    const sorted = [...limitedRows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return av - bv;
      }
      return String(av).localeCompare(String(bv));
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [limitedRows, sortKey, sortDir, sortable]);

  const pageCount = Math.ceil(sortedRows.length / pageSize);
  const displayRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  const handleHeaderClick = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  const handleExportCsv = useCallback(() => {
    const headers = columns.map((col) => col.label ?? col.key);
    const rowsCsv = sortedRows.map((row) =>
      columns.map((col) => formatCell(row[col.key], col.format)).map(csvEscape),
    );
    const csv = [
      headers.map(csvEscape).join(","),
      ...rowsCsv.map((r) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${panel.id}-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [columns, panel.id, sortedRows]);

  useEffect(() => {
    onExportCsvChange?.(handleExportCsv);
    return () => onExportCsvChange?.(null);
  }, [handleExportCsv, onExportCsvChange]);

  return (
    <div className="space-y-1">
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => {
                const label = col.label ?? col.key;
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={`text-left py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap ${
                      sortable
                        ? "cursor-pointer select-none hover:text-foreground"
                        : ""
                    }`}
                    onClick={() => handleHeaderClick(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortable &&
                        (isSorted ? (
                          sortDir === "asc" ? (
                            <IconSortAscending className="h-3 w-3" />
                          ) : (
                            <IconSortDescending className="h-3 w-3" />
                          )
                        ) : (
                          <IconArrowsSort className="h-3 w-3 opacity-30" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                {columns.map((col) => {
                  const raw = row[col.key];
                  if (col.format === "link") {
                    const formatted = formatCell(raw, col.format);
                    const href = col.linkKey
                      ? String(row[col.linkKey] ?? "")
                      : String(raw ?? "");
                    const safeHref = safeDashboardLinkHref(href);
                    return (
                      <td
                        key={col.key}
                        className="py-1.5 px-2 whitespace-nowrap"
                      >
                        {safeHref ? (
                          <a
                            href={safeHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {formatted}
                          </a>
                        ) : (
                          formatted
                        )}
                      </td>
                    );
                  }
                  const numeric =
                    col.format === "number" ||
                    col.format === "currency" ||
                    col.format === "percent" ||
                    col.format === "delta";
                  const content: ReactNode =
                    col.format === "delta"
                      ? renderDeltaCell(raw)
                      : formatCell(raw, col.format);
                  const replayHref = isSessionColumn(col.key)
                    ? sessionReplayHref(row)
                    : null;
                  return (
                    <td
                      key={col.key}
                      className={`py-1.5 px-2 whitespace-nowrap ${
                        numeric ? "text-right tabular-nums" : ""
                      }`}
                    >
                      {replayHref ? (
                        <span className="inline-flex flex-col gap-0.5">
                          <span>{content}</span>
                          <a
                            href={replayHref}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {t("sessions.watchReplay")}
                          </a>
                        </span>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sortedRows.length > PAGE_SIZE_OPTIONS[0] && (
        <div className="flex items-center justify-between px-1 pt-1 border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{t("common.rowsPerPage")}</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-6 w-16 px-2 py-0 text-xs border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <span>
              {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, sortedRows.length)} of{" "}
              {sortedRows.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
            >
              <IconChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= pageCount - 1}
            >
              <IconChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PieRenderer({
  rows,
  xKey,
  yKey,
  colors,
  panel,
}: {
  rows: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  colors: string[];
  panel: SqlPanel;
}) {
  const seriesNameFormatter = (name: string) =>
    formatSeriesLabelForPanel(panel, name);
  const legendKeys = rows.map((row) => String(row[xKey] ?? ""));

  return (
    <ChartFrame panel={panel} legendKeys={legendKeys} colors={colors}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey={yKey}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={(props: any) =>
              `${seriesNameFormatter(String(props.name))} ${((props.percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            {...CHART_TOOLTIP_PROPS}
            content={
              <ChartTooltip
                seriesNameFormatter={seriesNameFormatter}
                valueFormatter={(v) =>
                  formatYValue(v, panel.config?.yFormatter)
                }
              />
            }
          />
          {!usesPrometheusPresentation(panel) &&
            shouldShowLegend(panel, rows.length) && (
              <Legend {...CHART_LEGEND_PROPS} />
            )}
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function BarRenderer({
  rows,
  xKey,
  yKeys,
  colors,
  yFormatter,
  stacked,
  panel,
}: {
  rows: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  colors: string[];
  yFormatter?: "number" | "currency" | "percent";
  stacked?: boolean;
  panel: SqlPanel;
}) {
  const xLabelFormatter = (value: any) =>
    formatXLabel(String(value ?? ""), panel);
  const seriesNameFormatter = (name: string) =>
    formatSeriesLabelForPanel(panel, name);
  const { hiddenKeys, toggleSeries } = useSeriesVisibility(yKeys);

  return (
    <ChartFrame
      panel={panel}
      legendKeys={yKeys}
      colors={colors}
      hiddenKeys={hiddenKeys}
      onToggleLegendKey={toggleSeries}
      showCustomLegend
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <XAxis
            dataKey={xKey}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={xLabelFormatter}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatYValue(v, yFormatter)}
          />
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <Tooltip
            {...CHART_TOOLTIP_PROPS}
            cursor={BAR_TOOLTIP_CURSOR_PROPS}
            labelFormatter={xLabelFormatter}
            content={
              <ChartTooltip
                labelFormatter={xLabelFormatter}
                seriesNameFormatter={seriesNameFormatter}
                valueFormatter={(v) => formatYValue(v, yFormatter)}
              />
            }
            itemSorter={(item) => -(Number(item.value) || 0)}
          />
          {yKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              name={seriesNameFormatter(key)}
              fill={colors[i % colors.length]}
              radius={
                stacked && i < yKeys.length - 1 ? [0, 0, 0, 0] : [4, 4, 0, 0]
              }
              stackId={stacked ? "stack" : undefined}
              hide={hiddenKeys.has(key)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function TimeSeriesRenderer({
  rows,
  xKey,
  yKeys,
  colors,
  yFormatter,
  chartType,
  stacked,
  panel,
}: {
  rows: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  colors: string[];
  yFormatter?: "number" | "currency" | "percent";
  chartType: "line" | "area";
  stacked?: boolean;
  panel: SqlPanel;
}) {
  const xLabelFormatter = (value: any) =>
    formatXLabel(String(value ?? ""), panel);
  const seriesNameFormatter = (name: string) =>
    formatSeriesLabelForPanel(panel, name);
  const { hiddenKeys, visibleKeys, toggleSeries } = useSeriesVisibility(yKeys);
  const splitPartialDay = shouldSplitCurrentDayTimeSeries(panel, xKey);
  const { rows: chartRows, series } = useMemo(
    () =>
      splitPartialDay
        ? splitCurrentDayTimeSeriesRows(rows, xKey, yKeys)
        : {
            rows,
            series: yKeys.map((key) => ({
              key,
              solidKey: key,
              partialKey: null,
            })),
          },
    [rows, xKey, yKeys, splitPartialDay],
  );

  if (chartType === "line") {
    return (
      <ChartFrame
        panel={panel}
        legendKeys={yKeys}
        colors={colors}
        hiddenKeys={hiddenKeys}
        onToggleLegendKey={toggleSeries}
        showCustomLegend
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows}>
            <XAxis
              dataKey={xKey}
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={xLabelFormatter}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatYValue(v, yFormatter)}
            />
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <Tooltip
              {...CHART_TOOLTIP_PROPS}
              labelFormatter={xLabelFormatter}
              content={
                <ChartTooltip
                  labelFormatter={xLabelFormatter}
                  seriesNameFormatter={seriesNameFormatter}
                  valueFormatter={(v) => formatYValue(v, yFormatter)}
                />
              }
              itemSorter={(item) => -(Number(item.value) || 0)}
            />
            {series.map((item, i) => (
              <Line
                key={item.solidKey}
                type="monotone"
                dataKey={item.solidKey}
                name={seriesNameFormatter(item.key)}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={false}
                hide={hiddenKeys.has(item.key)}
              />
            ))}
            {series.map((item, i) =>
              item.partialKey ? (
                <Line
                  key={item.partialKey}
                  type="monotone"
                  dataKey={item.partialKey}
                  name={seriesNameFormatter(item.key)}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  strokeDasharray={PARTIAL_DAY_DASH}
                  dot={false}
                  hide={hiddenKeys.has(item.key)}
                />
              ) : null,
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    );
  }

  // With multiple series, filled areas stack and obscure lines behind them,
  // so only draw the gradient fill when there's a single series — unless
  // the caller asked for an explicit stacked area.
  const showFill = visibleKeys.length === 1 || stacked;

  return (
    <ChartFrame
      panel={panel}
      legendKeys={yKeys}
      colors={colors}
      hiddenKeys={hiddenKeys}
      onToggleLegendKey={toggleSeries}
      showCustomLegend
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartRows}>
          {showFill && (
            <defs>
              {yKeys.map((key, i) => (
                <linearGradient
                  key={key}
                  id={`sql-gradient-${key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={colors[i % colors.length]}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={colors[i % colors.length]}
                    stopOpacity={0}
                  />
                </linearGradient>
              ))}
            </defs>
          )}
          <XAxis
            dataKey={xKey}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={xLabelFormatter}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatYValue(v, yFormatter)}
          />
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <Tooltip
            {...CHART_TOOLTIP_PROPS}
            labelFormatter={xLabelFormatter}
            content={
              <ChartTooltip
                labelFormatter={xLabelFormatter}
                seriesNameFormatter={seriesNameFormatter}
                valueFormatter={(v) => formatYValue(v, yFormatter)}
              />
            }
            itemSorter={(item) => -(Number(item.value) || 0)}
          />
          {series.map((item, i) => (
            <Area
              key={item.solidKey}
              type="monotone"
              dataKey={item.solidKey}
              name={seriesNameFormatter(item.key)}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              fillOpacity={showFill ? 1 : 0}
              fill={showFill ? `url(#sql-gradient-${item.key})` : "none"}
              stackId={stacked ? "stack" : undefined}
              hide={hiddenKeys.has(item.key)}
            />
          ))}
          {series.map((item, i) =>
            item.partialKey ? (
              <Area
                key={item.partialKey}
                type="monotone"
                dataKey={item.partialKey}
                name={seriesNameFormatter(item.key)}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                strokeDasharray={PARTIAL_DAY_DASH}
                fill="none"
                fillOpacity={0}
                stackId={stacked ? "partial-stack" : undefined}
                hide={hiddenKeys.has(item.key)}
              />
            ) : null,
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// Heatmap config: `xKey` = x-axis column, `yKey` = numeric value column,
// `color` = optional row-label column. If `color` is omitted, the renderer
// auto-detects the row-label as the first non-x non-value string column.
function HeatmapRenderer({
  rows,
  panel,
}: {
  rows: Record<string, unknown>[];
  panel: SqlPanel;
}) {
  const t = useT();
  const cfg = panel.config;
  const yFormatter = cfg?.yFormatter;

  const { valueKey, rowKey, xValues, yValues, grid, stats } = useMemo(() => {
    if (rows.length === 0) {
      return {
        xKey: "",
        valueKey: "",
        rowKey: "",
        xValues: [] as string[],
        yValues: [] as string[],
        grid: new Map<string, number>(),
        stats: new Map<string, { mean: number; std: number }>(),
      };
    }
    const cols = Object.keys(rows[0]);
    const sample = rows[0] as Record<string, unknown>;
    const xK =
      cfg?.xKey || cols.find((c) => typeof sample[c] === "string") || cols[0];
    const valK =
      cfg?.yKey ||
      cols.find((c) => c !== xK && typeof sample[c] === "number") ||
      cols[1] ||
      "";
    const rowK =
      cfg?.color ||
      cols.find(
        (c) => c !== xK && c !== valK && typeof sample[c] === "string",
      ) ||
      "";

    const xs: string[] = [];
    const ys: string[] = [];
    const seenX = new Set<string>();
    const seenY = new Set<string>();
    const g = new Map<string, number>();
    for (const r of rows) {
      const xv = String(r[xK] ?? "");
      const yv = rowK ? String(r[rowK] ?? "") : "";
      const v = Number(r[valK]);
      if (!seenX.has(xv)) {
        seenX.add(xv);
        xs.push(xv);
      }
      if (!seenY.has(yv)) {
        seenY.add(yv);
        ys.push(yv);
      }
      if (Number.isFinite(v)) g.set(`${xv}\u0000${yv}`, v);
    }

    const s = new Map<string, { mean: number; std: number }>();
    for (const xv of xs) {
      const vals: number[] = [];
      for (const yv of ys) {
        const v = g.get(`${xv}\u0000${yv}`);
        if (v != null) vals.push(v);
      }
      if (vals.length === 0) {
        s.set(xv, { mean: 0, std: 0 });
        continue;
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance =
        vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      s.set(xv, { mean, std: Math.sqrt(variance) });
    }
    return {
      xKey: xK,
      valueKey: valK,
      rowKey: rowK,
      xValues: xs,
      yValues: ys,
      grid: g,
      stats: s,
    };
  }, [rows, cfg?.xKey, cfg?.yKey, cfg?.color]);

  if (rows.length === 0 || !valueKey) {
    return (
      <div className="flex min-h-[250px] items-center justify-center py-8">
        <p className="text-sm text-muted-foreground text-center">
          {t("common.noData")}
        </p>
      </div>
    );
  }

  const cellColor = (xv: string, v: number | undefined) => {
    if (v == null) return undefined;
    const stat = stats.get(xv);
    if (!stat) return undefined;
    const baseline = stat.std > 0 ? stat.std : Math.abs(stat.mean) || 1;
    const z = Math.max(-2, Math.min(2, (v - stat.mean) / baseline));
    const intensity = Math.min(2, Math.abs(z));
    const lightness = 90 - intensity * 25;
    const hue = z >= 0 ? 140 : 0;
    return `hsl(${hue}, 60%, ${lightness}%)`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap">
              {rowKey || ""}
            </th>
            {xValues.map((xv) => (
              <th
                key={xv}
                className="text-right py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap"
              >
                {formatXLabel(xv, panel)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yValues.map((yv) => (
            <tr key={yv} className="border-b border-border/50">
              <td className="py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap">
                {yv || "—"}
              </td>
              {xValues.map((xv) => {
                const v = grid.get(`${xv}\u0000${yv}`);
                const bg = cellColor(xv, v);
                return (
                  <td
                    key={xv}
                    className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap"
                    style={bg ? { backgroundColor: bg } : undefined}
                  >
                    {v != null ? formatYValue(v, yFormatter) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type CalloutSeverity = "info" | "warning" | "critical";

function CalloutRenderer({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;

  const styleFor = (severity: CalloutSeverity) => {
    if (severity === "critical") {
      return {
        wrapper:
          "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
        Icon: IconAlertTriangle,
      };
    }
    if (severity === "warning") {
      return {
        wrapper:
          "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        Icon: IconAlertTriangle,
      };
    }
    return {
      wrapper: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
      Icon: IconInfoCircle,
    };
  };

  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const sevRaw = String(row.severity ?? "info").toLowerCase();
        const severity: CalloutSeverity =
          sevRaw === "critical" || sevRaw === "warning" || sevRaw === "info"
            ? (sevRaw as CalloutSeverity)
            : "info";
        const message = String(row.message ?? "");
        const { wrapper, Icon } = styleFor(severity);
        return (
          <div
            key={i}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${wrapper}`}
          >
            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="break-words">{message}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SqlChartWithCard({ panel }: { panel: SqlPanel }) {
  return (
    <Card className="flex h-full flex-col overflow-visible">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 shrink-0">
        <CardTitle className="text-sm font-medium truncate">
          {panel.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col overflow-visible pt-0">
        <SqlChart panel={panel} />
      </CardContent>
    </Card>
  );
}
