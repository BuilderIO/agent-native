import { useT } from "@agent-native/core/client/i18n";
import { useMemo, type ReactNode } from "react";

import {
  limitChartRows,
  planPanelRender,
  resolveSeriesColors,
} from "../../dashboard/panel-render-contract.js";
import type {
  ChartType,
  SqlPanel,
} from "../../dashboard/sql-dashboard-types.js";
import { DashboardPanelDescription } from "./DashboardPanelDescription.js";
import {
  BarRenderer,
  CalloutRenderer,
  ChartPointLimitNote,
  ComboRenderer,
  ConfigWarning,
  DEFAULT_COLORS,
  FunnelRenderer,
  HEATMAP_PANEL_MIN_HEIGHT_CLASS,
  HeatmapRenderer,
  isTableLikeChartType,
  MetricRenderer,
  PieRenderer,
  TABLE_PLACEHOLDER_MIN_HEIGHT_CLASS,
  TableRenderer,
  TimeSeriesRenderer,
  type DatumClickHandler,
} from "./panel-chart.js";

export interface DashboardPanelChartProps {
  /** Its chart type and config decide how the rows are drawn. */
  panel: SqlPanel;
  /** The panel query's rows, already loaded: this component runs no query. */
  rows: Record<string, unknown>[];
  /** The dashboard's time range in days, which only a pivot reads. */
  timeRange?: number;
  /** Hears the point, bar or slice a reader picks. */
  onDatumClick?: DatumClickHandler;
}

/**
 * Draws a dashboard panel from rows already in hand, the way an Analytics
 * dashboard draws it. Tables are read-only. On its own it marks only the
 * panel's `config.events`; wrap it in `DashboardPanelChartHostProvider` to add
 * an app's data notes or session replay links.
 */
export function DashboardPanelChart({
  panel,
  rows: rawRows,
  timeRange,
  onDatumClick,
}: DashboardPanelChartProps) {
  const t = useT();
  const plan = useMemo(
    () =>
      planPanelRender(
        rawRows,
        panel,
        timeRange === undefined ? {} : { timeRange },
      ),
    [rawRows, panel, timeRange],
  );
  const { rows, xKey, yKeys } = plan;
  const chartType: ChartType =
    (panel.chartType as string) === "stacked-bar"
      ? "bar"
      : (panel.chartType as string) === "stacked-area"
        ? "area"
        : panel.chartType;
  const chartRows = useMemo(
    () => limitChartRows(rows, chartType, xKey),
    [chartType, rows, xKey],
  );

  // A section is a heading and an extension is another app's view: neither
  // draws rows.
  if (chartType === "section" || chartType === "extension") {
    return null;
  }

  const colors = panel.config?.colors?.length
    ? panel.config.colors
    : DEFAULT_COLORS;
  const seriesColors = resolveSeriesColors(
    plan.yKeys,
    plan.colorSlots,
    panel,
    colors,
  );
  const yFormatter = panel.config?.yFormatter;

  // As on a dashboard: the panel's description above, then any warning about
  // settings its rows don't satisfy.
  const withConfigWarning = (node: ReactNode) => {
    const content =
      plan.missingKeys.length > 0 ? (
        <div className="space-y-2">
          <ConfigWarning keys={plan.missingKeys} />
          {node}
        </div>
      ) : (
        node
      );
    const description = panel.config?.description;
    if (typeof description !== "string" || !description) return content;
    return (
      <div className="flex h-full min-h-0 flex-col gap-1.5">
        <DashboardPanelDescription
          description={description}
          collapsible
          className="shrink-0 text-xs leading-relaxed text-muted-foreground"
        />
        <div className="min-h-0 flex-1">{content}</div>
      </div>
    );
  };
  const withPointLimit = (node: ReactNode) =>
    plan.pointLimit ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">{node}</div>
        <ChartPointLimitNote limit={plan.pointLimit} />
      </div>
    ) : (
      node
    );

  if (plan.empty) {
    const isMetric = panel.chartType === "metric";
    const placeholderMinH = isMetric
      ? "min-h-12"
      : panel.chartType === "heatmap"
        ? HEATMAP_PANEL_MIN_HEIGHT_CLASS
        : isTableLikeChartType(panel.chartType)
          ? TABLE_PLACEHOLDER_MIN_HEIGHT_CLASS
          : "min-h-[250px]";
    const noData = (
      <div
        className={`flex h-full flex-1 items-center justify-center ${isMetric ? "py-2" : "py-8"} ${placeholderMinH}`}
      >
        <p className="text-sm text-muted-foreground text-center">
          {t("common.noData")}
        </p>
      </div>
    );
    // A funnel or heatmap with rows that draws nothing keeps the warning that
    // says why; a result with no rows to plot is a bare "No data".
    return plan.rows.length === 0 ? noData : withConfigWarning(noData);
  }

  switch (chartType) {
    case "metric":
      return withConfigWarning(<MetricRenderer rows={rows} panel={panel} />);
    case "table":
      return withConfigWarning(<TableRenderer rows={rows} panel={panel} />);
    case "pie":
      return withConfigWarning(
        withPointLimit(
          <PieRenderer
            rows={chartRows}
            xKey={xKey}
            yKey={yKeys[0] ?? ""}
            colors={colors}
            panel={panel}
            onDatumClick={onDatumClick}
          />,
        ),
      );
    case "bar":
      return withConfigWarning(
        withPointLimit(
          <BarRenderer
            rows={chartRows}
            xKey={xKey}
            yKeys={yKeys}
            colors={seriesColors}
            yFormatter={yFormatter}
            stacked={panel.config?.stacked === true}
            panel={panel}
            onDatumClick={onDatumClick}
          />,
        ),
      );
    case "combo":
      return withConfigWarning(
        withPointLimit(
          <ComboRenderer
            rows={chartRows}
            xKey={xKey}
            yKeys={yKeys}
            colors={seriesColors}
            yFormatter={yFormatter}
            barKeys={panel.config?.barKeys ?? []}
            panel={panel}
            onDatumClick={onDatumClick}
          />,
        ),
      );
    case "funnel":
      if (!plan.funnel) break;
      return withConfigWarning(
        withPointLimit(
          <FunnelRenderer
            funnel={plan.funnel}
            panel={panel}
            colors={colors}
            onDatumClick={onDatumClick}
          />,
        ),
      );
    case "heatmap":
      if (!plan.heatmap) break;
      return withConfigWarning(
        withPointLimit(
          <HeatmapRenderer
            rows={chartRows}
            panel={panel}
            keys={plan.heatmap}
          />,
        ),
      );
    case "callout":
      return withConfigWarning(
        withPointLimit(<CalloutRenderer rows={chartRows} />),
      );
    case "line":
    case "area":
      return withConfigWarning(
        withPointLimit(
          <TimeSeriesRenderer
            rows={chartRows}
            xKey={xKey}
            yKeys={yKeys}
            colors={seriesColors}
            yFormatter={yFormatter}
            chartType={chartType}
            stacked={panel.config?.stacked === true}
            panel={panel}
            onDatumClick={onDatumClick}
          />,
        ),
      );
  }
  return withConfigWarning(<TableRenderer rows={rows} panel={panel} />);
}
