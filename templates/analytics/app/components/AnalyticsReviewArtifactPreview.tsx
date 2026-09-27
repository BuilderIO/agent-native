import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";

import { SqlChart } from "@/components/dashboard/SqlChart";
import Markdown from "@/components/Markdown";
import type { SqlQueryResult } from "@/lib/sql-query";
import {
  resolveFilterVars,
  reviewDashboardFilters,
  reviewDashboardVariables,
} from "@/pages/adhoc/sql-dashboard/filter-vars";
import { interpolate } from "@/pages/adhoc/sql-dashboard/interpolate";
import { serializePanelSql } from "@/pages/adhoc/sql-dashboard/panel-sql";
import { timeRangeDays } from "@/pages/adhoc/sql-dashboard/pivot";
import type {
  DataSourceType,
  ChartType,
  SqlPanel,
} from "@/pages/adhoc/sql-dashboard/types";
import LegacyFusionAnalysis, {
  isLegacyFusionAnalysis,
} from "@/pages/analyses/LegacyFusionAnalysis";

export {
  reviewDashboardFilters,
  reviewDashboardVariables,
} from "@/pages/adhoc/sql-dashboard/filter-vars";

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

export function firstReviewDashboardPanel(
  value: unknown,
): SqlPanel | undefined {
  return reviewDashboardPanels(value)[0];
}

export function reviewDashboardPanels(value: unknown): SqlPanel[] {
  if (!isRecord(value) || !Array.isArray(value.panels)) return [];
  const panels = value.panels
    .filter(isSqlPanel)
    .filter(
      (panel) =>
        panel.source !== "demo" &&
        panel.source !== "program" &&
        panel.chartType !== "section" &&
        panel.chartType !== "extension",
    );
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const preferredIds =
    isRecord(value.layout) && Array.isArray(value.layout.firstPanelIds)
      ? value.layout.firstPanelIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [];
  const orderedIds =
    isRecord(value.layout) && Array.isArray(value.layout.panelOrder)
      ? value.layout.panelOrder.filter(
          (id): id is string => typeof id === "string",
        )
      : preferredIds;
  const preferred = orderedIds.flatMap((id) => {
    const panel = byId.get(id);
    return panel ? [panel] : [];
  });
  return [
    ...preferred,
    ...panels.filter((panel) => !orderedIds.includes(panel.id)),
  ];
}

export function AnalyticsReviewArtifactPreview({
  artifactId,
  artifactPath,
  compact,
  reviewOrgId,
}: {
  artifactId: string;
  artifactPath?: string;
  compact: boolean;
  reviewOrgId: string;
}) {
  return artifactPath?.startsWith("/analyses/") ? (
    <AnalyticsReviewAnalysisPreview
      artifactId={artifactId}
      compact={compact}
      reviewOrgId={reviewOrgId}
    />
  ) : (
    <AnalyticsReviewDashboardPreview
      artifactId={artifactId}
      compact={compact}
      reviewOrgId={reviewOrgId}
    />
  );
}

function AnalyticsReviewDashboardPreview({
  artifactId,
  compact,
  reviewOrgId,
}: {
  artifactId: string;
  compact: boolean;
  reviewOrgId: string;
}) {
  const t = useT();
  const { data, isLoading, isError } = useActionQuery<Record<string, unknown>>(
    "get-sql-dashboard",
    {
      id: artifactId,
      includeConfig: true,
      reviewPreview: true,
      reviewOrgId,
    },
    { staleTime: 5 * 60_000 },
  );
  const panels = reviewDashboardPanels(data);
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
  if (isError || panels.length === 0 || !filters || !variables) {
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
  const visiblePanels = compact ? panels.slice(0, 1) : panels;

  return (
    <div
      className={
        compact
          ? "pointer-events-none h-[600%] w-[600%] origin-top-left scale-[0.166667] overflow-hidden"
          : "min-h-64 w-full overflow-visible"
      }
      data-preview-kind="analytics-sql-chart"
    >
      {visiblePanels.map((panel) => (
        <ReviewDashboardPanel
          key={panel.id}
          artifactId={artifactId}
          reviewOrgId={reviewOrgId}
          panel={panel}
          variables={vars}
          compact={compact}
        />
      ))}
    </div>
  );
}

function ReviewDashboardPanel({
  artifactId,
  reviewOrgId,
  panel,
  variables,
  compact,
}: {
  artifactId: string;
  reviewOrgId: string;
  panel: SqlPanel;
  variables: Record<string, string>;
  compact: boolean;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(
    compact || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (compact) {
      setNearViewport(true);
      return;
    }
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: "180px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [compact]);

  const query = useActionQuery<Record<string, unknown>>(
    "query-observability-review-panel",
    { dashboardId: artifactId, panelId: panel.id, reviewOrgId },
    { enabled: nearViewport, staleTime: 5 * 60_000 },
  );
  const data = query.data;
  const result: SqlQueryResult | undefined =
    data && Array.isArray(data.rows)
      ? {
          rows: data.rows.filter(isRecord),
          schema: Array.isArray(data.schema)
            ? data.schema.filter(
                (field): field is { name: string; type: string } =>
                  isRecord(field) &&
                  typeof field.name === "string" &&
                  typeof field.type === "string",
              )
            : undefined,
          error:
            typeof data.error === "string"
              ? typeof data.message === "string"
                ? data.message
                : data.error
              : undefined,
        }
      : data && typeof data.error === "string"
        ? {
            rows: [],
            error: typeof data.message === "string" ? data.message : data.error,
          }
        : undefined;

  if (!nearViewport || query.isLoading) {
    return (
      <div ref={containerRef} className="h-72 w-full">
        <div
          aria-hidden="true"
          className="size-full animate-pulse rounded-md bg-muted"
        />
      </div>
    );
  }
  if (query.isError || !result) {
    return (
      <div
        ref={containerRef}
        className="flex h-72 items-center justify-center text-sm text-muted-foreground"
        data-preview-state="unavailable"
        role="status"
      >
        {t("settings.reviewPreviewUnavailable")}
      </div>
    );
  }

  const resolvedSql = interpolate(serializePanelSql(panel.sql), variables, {
    failClosedTimeVariables: true,
  });
  return (
    <div ref={containerRef} className="min-w-0 border-b border-border/70 pb-5">
      {!compact && (
        <h3 className="mb-2 truncate text-sm font-medium">{panel.title}</h3>
      )}
      <SqlChart
        panel={panel}
        resolvedSql={resolvedSql}
        timeRange={timeRangeDays(variables.timeRange)}
        loadData={false}
        resultOverride={result}
        showLoadingWhenDisabled={false}
        dashboardId={artifactId}
      />
    </div>
  );
}

function AnalyticsReviewAnalysisPreview({
  artifactId,
  compact,
  reviewOrgId,
}: {
  artifactId: string;
  compact: boolean;
  reviewOrgId: string;
}) {
  const t = useT();
  const { data, isLoading, isError } = useActionQuery<Record<string, unknown>>(
    "get-analysis",
    { id: artifactId, reviewPreview: true, reviewOrgId },
    { staleTime: 5 * 60_000 },
  );
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
  if (
    isError ||
    typeof data?.id !== "string" ||
    typeof data.name !== "string" ||
    typeof data.resultMarkdown !== "string"
  ) {
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

  const analysis = {
    id: data.id,
    name: data.name,
    resultData:
      typeof data.resultData === "object" &&
      data.resultData !== null &&
      !Array.isArray(data.resultData)
        ? (data.resultData as Record<string, unknown>)
        : null,
  };
  return (
    <div
      className={
        compact
          ? "pointer-events-none h-[600%] w-[600%] origin-top-left scale-[0.166667] overflow-auto p-5"
          : "h-full min-h-64 w-full overflow-auto p-5"
      }
      data-preview-kind="analytics-saved-analysis"
    >
      {isLegacyFusionAnalysis(artifactId) ? (
        <LegacyFusionAnalysis analysis={analysis} />
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Markdown content={data.resultMarkdown} />
        </div>
      )}
    </div>
  );
}
