import { z } from "zod";

/**
 * The contract between Analytics and an app that keeps a frozen copy of one
 * dashboard panel, such as a chart in a Content page. Analytics owns the
 * query, access and chart semantics; the other app stores the returned
 * rows and draws them with toolkit's dashboard charts.
 */

/** Panels drawn as charts from the stored rows. */
export const ANALYTICS_CAPTURE_CHART_TYPES = [
  "line",
  "area",
  "bar",
  "combo",
  "pie",
  "funnel",
] as const;

/** Every panel type a capture can hold. */
export const ANALYTICS_CAPTURE_PANEL_TYPES = [
  ...ANALYTICS_CAPTURE_CHART_TYPES,
  "metric",
  "table",
] as const;

export type AnalyticsCaptureChartType =
  (typeof ANALYTICS_CAPTURE_CHART_TYPES)[number];
export type AnalyticsCapturePanelType =
  (typeof ANALYTICS_CAPTURE_PANEL_TYPES)[number];

/**
 * Most rows a capture keeps. A pivoted chart's query returns one row per
 * date and series, so a year of daily points over a few series fits.
 */
export const ANALYTICS_CAPTURE_MAX_ROWS = 1000;
/** Most rows a table capture keeps, matching what a report email shows. */
export const ANALYTICS_CAPTURE_MAX_TABLE_ROWS = 50;
export const ANALYTICS_CAPTURE_MAX_COLUMNS = 24;
/** Most key dates a capture marks on its chart. */
export const ANALYTICS_CAPTURE_MAX_EVENTS = 100;
/** Most series colors a capture keeps: a pivot can draw more series than columns. */
export const ANALYTICS_CAPTURE_MAX_COLORS = 100;
/** The longest dashboard time range, in days, a pivoted chart fills against. */
export const ANALYTICS_CAPTURE_MAX_TIME_RANGE_DAYS = 800;

/** The data source types a dashboard panel reads, as toolkit names them. */
export const ANALYTICS_CAPTURE_SOURCES = [
  "bigquery",
  "ga4",
  "amplitude",
  "first-party",
  "demo",
  "prometheus",
  "program",
] as const;
export type AnalyticsCaptureSource = (typeof ANALYTICS_CAPTURE_SOURCES)[number];
const MAX_FILTERS = 40;
const MAX_CELL_TEXT = 500;
const MAX_KEY = 200;
const MAX_LABEL = 200;

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/, "Use the id from the panel's copied link.");

const filtersSchema = z
  .record(z.string().trim().min(1).max(100), z.string().max(500))
  .refine((value) => Object.keys(value).length <= MAX_FILTERS, {
    message: `At most ${MAX_FILTERS} filters.`,
  });

const httpUrlSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  }, "Expected an http(s) URL.");

const visibilitySchema = z.enum(["private", "org", "public"]);

const colorSchema = z
  .string()
  .regex(/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i, "Expected a hex color.");

/**
 * A series color: hex, an RGB or HSL function with numbers only, a color name,
 * or a theme color as `var(--name)`. Nothing else, so a page can't carry
 * other CSS, such as a `url()`, into the chart.
 */
const seriesColorSchema = z
  .string()
  .regex(
    /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|var\(--[\w-]{1,64}\)|(?:rgb|hsl)a?\([\d\s.,%/]{1,60}\)|[a-z]{3,30})$/i,
    "Expected a hex, RGB, HSL or named color, or var(--name).",
  );

export const analyticsCaptureCellSchema = z.union([
  z.string().max(MAX_CELL_TEXT),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type AnalyticsCaptureCell = z.infer<typeof analyticsCaptureCellSchema>;

const columnKeySchema = z.string().max(MAX_KEY);
const columnKeysSchema = z
  .array(columnKeySchema)
  .max(ANALYTICS_CAPTURE_MAX_COLUMNS);
const labelsSchema = z
  .record(columnKeySchema, z.string().max(MAX_LABEL))
  .refine((value) => Object.keys(value).length <= 100, {
    message: "At most 100 labels.",
  });
const valueFormatterSchema = z.enum([
  "number",
  "currency",
  "percent",
  "duration",
]);

/** A key date the chart marks, as dashboard panels store them. */
export const analyticsCaptureEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD."),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Expected HH:MM.")
    .optional(),
  timeZone: z.string().max(64).optional(),
  label: z.string().max(MAX_LABEL),
  color: colorSchema.optional(),
});
export type AnalyticsCaptureEvent = z.infer<typeof analyticsCaptureEventSchema>;

/**
 * The chart settings of the dashboard panel a capture came from, so another
 * app draws its rows exactly as the dashboard does. Only settings that
 * change the drawing are kept: no query, drilldown, breakdown or extension.
 * The panel's own key dates and its dashboard's key-date sets both arrive as
 * `events`.
 */
export const analyticsCaptureChartConfigSchema = z.object({
  xKey: columnKeySchema.optional(),
  yKey: columnKeySchema.optional(),
  yKeys: columnKeysSchema.optional(),
  rightYKeys: columnKeysSchema.optional(),
  barKeys: columnKeysSchema.optional(),
  colors: z
    .array(seriesColorSchema)
    .max(ANALYTICS_CAPTURE_MAX_COLORS)
    .optional(),
  yFormatter: valueFormatterSchema.optional(),
  rightYFormatter: valueFormatterSchema.optional(),
  seriesLabels: labelsSchema.optional(),
  valueLabels: labelsSchema.optional(),
  description: z.string().max(2000).optional(),
  pivot: z
    .object({
      xKey: columnKeySchema,
      seriesKey: columnKeySchema,
      valueKey: columnKeySchema,
      seriesOrder: z.array(z.string().max(MAX_LABEL)).max(100).optional(),
    })
    .optional(),
  funnelOutcomes: z
    .object({
      completedKey: columnKeySchema,
      leftKey: columnKeySchema,
      skippedKey: columnKeySchema.optional(),
      optionalKey: columnKeySchema.optional(),
    })
    .optional(),
  stacked: z.boolean().optional(),
  legend: z.boolean().optional(),
  sortable: z.boolean().optional(),
  comparison: z
    .object({
      previousKey: columnKeySchema.optional(),
      periodKey: columnKeySchema.optional(),
      label: z.string().max(MAX_LABEL).optional(),
      better: z.enum(["higher", "lower", "neither"]).optional(),
    })
    .optional(),
  columns: z
    .array(
      z.object({
        key: columnKeySchema,
        label: z.string().max(MAX_LABEL).optional(),
        format: z
          .enum([
            "number",
            "currency",
            "percent",
            "date",
            "link",
            "text",
            "delta",
            "duration",
          ])
          .optional(),
        linkKey: columnKeySchema.optional(),
        hidden: z.boolean().optional(),
        width: z.number().int().min(1).max(4000).optional(),
      }),
    )
    .max(ANALYTICS_CAPTURE_MAX_COLUMNS)
    .optional(),
  limit: z.number().int().min(1).max(10_000).optional(),
  events: z
    .array(analyticsCaptureEventSchema)
    .max(ANALYTICS_CAPTURE_MAX_EVENTS)
    .optional(),
});
export type AnalyticsCaptureChartConfig = z.infer<
  typeof analyticsCaptureChartConfigSchema
>;

export const analyticsPanelCaptureRequestSchema = z.object({
  dashboardId: idSchema.describe("Dashboard id, from the panel's copied link."),
  panelId: idSchema.describe(
    "Panel id, the `tile` parameter of the panel's copied link.",
  ),
  filters: filtersSchema
    .optional()
    .describe(
      "Filter values keyed by filter id, as the dashboard URL carries them without the f_ prefix, e.g. {timeRange: '90d'}. Omit for the dashboard's defaults.",
    ),
});
export type AnalyticsPanelCaptureRequest = z.infer<
  typeof analyticsPanelCaptureRequestSchema
>;

export const analyticsPanelCaptureSchema = z.object({
  dashboard: z.object({
    id: idSchema,
    title: z.string().max(300),
    url: httpUrlSchema,
    /** Who can open the dashboard right now, as Analytics stores it. */
    visibility: visibilitySchema,
  }),
  panel: z.object({
    id: idSchema,
    title: z.string().max(300),
    type: z.enum(ANALYTICS_CAPTURE_PANEL_TYPES),
    /** The panel's data source, which decides how some series labels read. */
    source: z.enum(ANALYTICS_CAPTURE_SOURCES).optional(),
    /** Changes when the panel's saved query or chart settings change. */
    fingerprint: z.string().regex(/^[a-f0-9]{12}$/),
    url: httpUrlSchema,
  }),
  /** The filter values the numbers were captured with, keyed by filter id. */
  filters: filtersSchema,
  /** The same filters as one short line for people, e.g. "Last 90 days". */
  filterSummary: z.string().max(500).optional(),
  /** How the dashboard draws these rows. */
  chart: analyticsCaptureChartConfigSchema,
  /**
   * Pivoted charts only: the dashboard's time range in days. A pivot fills
   * the days with no rows across it, ending on the day of `capturedAt`
   * rather than today, so the copy keeps the days the dashboard drew.
   */
  timeRange: z
    .number()
    .int()
    .min(1)
    .max(ANALYTICS_CAPTURE_MAX_TIME_RANGE_DAYS)
    .optional(),
  /** The query's columns the chart draws, as the chart settings name them. */
  columns: z.array(columnKeySchema).min(1).max(ANALYTICS_CAPTURE_MAX_COLUMNS),
  /** The query's rows as the panel returned them, one cell per column. */
  rows: z
    .array(
      z.array(analyticsCaptureCellSchema).max(ANALYTICS_CAPTURE_MAX_COLUMNS),
    )
    .max(ANALYTICS_CAPTURE_MAX_ROWS),
  /** Metric only: the value as the dashboard shows it, and its comparison. */
  display: z
    .object({
      value: z.string().max(200),
      comparison: z.string().max(300).optional(),
    })
    .optional(),
  /** True when the panel returned more rows or columns than the capture keeps. */
  truncated: z.boolean(),
  capturedAt: z.string().datetime(),
});
export type AnalyticsPanelCapture = z.infer<typeof analyticsPanelCaptureSchema>;

/** A capture's rows as records keyed by column, as a dashboard panel reads them. */
export function analyticsCaptureRecords(
  capture: Pick<AnalyticsPanelCapture, "columns" | "rows">,
): Record<string, AnalyticsCaptureCell>[] {
  return capture.rows.map((row) =>
    Object.fromEntries(
      capture.columns.map((column, index) => [column, row[index] ?? null]),
    ),
  );
}

export const analyticsPanelStatusRequestSchema = z.object({
  dashboardId: idSchema.describe("Dashboard id."),
  panelIds: z
    .array(idSchema)
    .max(50)
    .default([])
    .describe("Panels to report on; empty for the dashboard's sharing only."),
});
export type AnalyticsPanelStatusRequest = z.infer<
  typeof analyticsPanelStatusRequestSchema
>;

export const analyticsPanelStatusSchema = z.object({
  dashboard: z.object({
    id: idSchema,
    title: z.string().max(300),
    visibility: visibilitySchema,
  }),
  panels: z
    .array(
      z.object({
        id: idSchema,
        /** Null when the panel is gone from the dashboard. */
        fingerprint: z
          .string()
          .regex(/^[a-f0-9]{12}$/)
          .nullable(),
        type: z.string().max(40).nullable(),
      }),
    )
    .max(50),
});
export type AnalyticsPanelStatus = z.infer<typeof analyticsPanelStatusSchema>;

const FILTER_PARAM_PREFIX = "f_";

/**
 * Reads a panel's copied link ("Copy link" on a dashboard panel):
 * `<analytics>/dashboards/<id>?f_<filter>=…&tile=<panelId>`. Returns null for
 * anything else, including a dashboard link without a panel. `origins` are
 * the Analytics origins this deployment trusts; the link may carry an app
 * base path such as `/analytics`.
 */
export function parseAnalyticsPanelLink(
  value: string,
  origins: readonly string[],
): AnalyticsPanelCaptureRequest | null {
  const text = value.trim();
  if (!text || /\s/.test(text) || !URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const trusted = origins.some((origin) => {
    if (!URL.canParse(origin)) return false;
    return new URL(origin).origin === url.origin;
  });
  if (!trusted) return null;
  const match = /(?:^|\/)dashboards\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  const [, rawDashboardId = ""] = match;
  let dashboardId: string;
  try {
    dashboardId = decodeURIComponent(rawDashboardId);
    // coercion-ok: a malformed escape isn't a panel link, and null is this parser's "not a panel link"
  } catch {
    return null;
  }
  const panelId = url.searchParams.get("tile") ?? "";
  const filters: Record<string, string> = {};
  for (const [key, paramValue] of url.searchParams) {
    if (key.startsWith(FILTER_PARAM_PREFIX) && key.length > 2) {
      filters[key.slice(FILTER_PARAM_PREFIX.length)] = paramValue;
    }
  }
  const parsed = analyticsPanelCaptureRequestSchema.safeParse({
    dashboardId,
    panelId,
    ...(Object.keys(filters).length ? { filters } : {}),
  });
  return parsed.success ? parsed.data : null;
}
