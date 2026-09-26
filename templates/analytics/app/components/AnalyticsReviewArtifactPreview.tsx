import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";

import { SqlChart } from "@/components/dashboard/SqlChart";
import { resolveFilterVars } from "@/pages/adhoc/sql-dashboard/DashboardFilterBar";
import { interpolate } from "@/pages/adhoc/sql-dashboard/interpolate";
import { serializePanelSql } from "@/pages/adhoc/sql-dashboard/panel-sql";
import { timeRangeDays } from "@/pages/adhoc/sql-dashboard/pivot";
import type {
  DashboardFilter,
  DataSourceType,
  ChartType,
  SqlPanel,
} from "@/pages/adhoc/sql-dashboard/types";

const DATA_SOURCES: DataSourceType[] = [
  "bigquery",
  "ga4",
  "amplitude",
  "first-party",
  "demo",
  "prometheus",
  "program",
];
const CHART_TYPES: ChartType[] = [
  "line",
  "area",
  "bar",
  "metric",
  "table",
  "pie",
  "section",
  "funnel",
  "heatmap",
  "callout",
  "extension",
];
const FILTER_TYPES: DashboardFilter["type"][] = [
  "date",
  "date-range",
  "select",
  "toggle",
  "text",
  "toggle-date",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSqlPanel(value: unknown): value is SqlPanel {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.sql === "string" &&
    typeof value.width === "number" &&
    DATA_SOURCES.includes(value.source as DataSourceType) &&
    CHART_TYPES.includes(value.chartType as ChartType) &&
    (value.config === undefined || isRecord(value.config))
  );
}

function isDashboardFilter(value: unknown): value is DashboardFilter {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.label !== "string" ||
    !FILTER_TYPES.includes(value.type as DashboardFilter["type"]) ||
    (value.default !== undefined && typeof value.default !== "string")
  ) {
    return false;
  }
  return (
    value.options === undefined ||
    (Array.isArray(value.options) &&
      value.options.length <= 100 &&
      value.options.every(
        (option) =>
          isRecord(option) &&
          typeof option.value === "string" &&
          typeof option.label === "string",
      ))
  );
}

export function reviewDashboardFilters(
  value: unknown,
): DashboardFilter[] | undefined {
  if (!isRecord(value) || value.filters === undefined) return [];
  return Array.isArray(value.filters) &&
    value.filters.length <= 100 &&
    value.filters.every(isDashboardFilter)
    ? value.filters
    : undefined;
}

export function reviewDashboardVariables(
  value: unknown,
): Record<string, string> | undefined {
  if (!isRecord(value) || value.variables === undefined) return {};
  if (!isRecord(value.variables)) return undefined;
  const entries = Object.entries(value.variables);
  if (
    entries.length > 100 ||
    entries.some(([, variable]) => typeof variable !== "string")
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function firstReviewDashboardPanel(
  value: unknown,
): SqlPanel | undefined {
  if (!isRecord(value) || !Array.isArray(value.panels)) return undefined;
  const panels = value.panels.filter(isSqlPanel);
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const preferredIds =
    isRecord(value.layout) && Array.isArray(value.layout.firstPanelIds)
      ? value.layout.firstPanelIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [];
  const preferred = preferredIds.flatMap((id) => {
    const panel = byId.get(id);
    return panel ? [panel] : [];
  });
  const ordered = [
    ...preferred,
    ...panels.filter((panel) => !preferredIds.includes(panel.id)),
  ];
  return ordered.find(
    (panel) =>
      panel.source !== "demo" &&
      panel.source !== "program" &&
      panel.chartType !== "section" &&
      panel.chartType !== "extension",
  );
}

export function AnalyticsReviewArtifactPreview({
  artifactId,
  compact,
}: {
  artifactId: string;
  compact: boolean;
}) {
  const t = useT();
  const { data, isLoading, isError } = useActionQuery<Record<string, unknown>>(
    "get-sql-dashboard",
    { id: artifactId, includeConfig: true, reviewPreview: true },
    { staleTime: 5 * 60_000 },
  );
  const panel = firstReviewDashboardPanel(data);
  const filters = reviewDashboardFilters(data);
  const variables = reviewDashboardVariables(data);
  if (isLoading) {
    return (
      <div
        aria-hidden="true"
        className={
          compact
            ? "size-full animate-pulse bg-muted"
            : "h-full min-h-64 w-full animate-pulse bg-muted"
        }
      />
    );
  }
  if (isError || !panel || !filters || !variables) {
    return (
      <div
        className="flex size-full items-center justify-center bg-muted px-2 text-center text-xs text-muted-foreground"
        data-preview-state="unavailable"
        role="status"
      >
        {t("settings.reviewPreviewUnavailable")}
      </div>
    );
  }

  const vars = { ...variables, ...resolveFilterVars(filters, () => "") };
  const resolvedSql = interpolate(serializePanelSql(panel.sql), vars, {
    failClosedTimeVariables: true,
  });

  return (
    <div
      className={
        compact
          ? "pointer-events-none h-[600%] w-[600%] origin-top-left scale-[0.166667] overflow-hidden"
          : "h-full min-h-64 w-full overflow-hidden"
      }
      data-preview-kind="analytics-sql-chart"
    >
      <SqlChart
        panel={panel}
        resolvedSql={resolvedSql}
        timeRange={timeRangeDays(vars.timeRange)}
        dashboardId={artifactId}
        loadData={false}
      />
    </div>
  );
}
