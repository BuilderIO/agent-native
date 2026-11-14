import { useDemoModeStatus } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { DashboardPanelDescription } from "@agent-native/toolkit/app/dashboard-charts/DashboardPanelDescription";
import {
  DEFAULT_COLORS,
  TABLE_PLACEHOLDER_MIN_HEIGHT_CLASS,
  TABLE_SKELETON_ROWS,
  HEATMAP_PANEL_MIN_HEIGHT_CLASS,
  HEATMAP_SKELETON_ROWS,
  formatSqlChartError,
  ChartFillHeightContext,
  isTableLikeChartType,
  chartTypeReservesLegend,
  ConfigWarning,
  ChartPointLimitNote,
  type DatumClickHandler,
  MetricRenderer,
  TableRenderer,
  PieRenderer,
  BarRenderer,
  ComboRenderer,
  TimeSeriesRenderer,
  FunnelRenderer,
  HeatmapRenderer,
  CalloutRenderer,
} from "@agent-native/toolkit/app/dashboard-charts/panel-chart";
import { DashboardPanelChartHostProvider } from "@agent-native/toolkit/app/dashboard-charts/panel-chart-host";
import {
  EmbeddedExtension,
  ExtensionSlot,
} from "@agent-native/toolkit/app/extensions";
import {
  limitChartRows,
  planPanelRender,
  resolveSeriesColors,
} from "@agent-native/toolkit/dashboard/panel-render-contract";
import type {
  SqlPanel,
  ChartType,
  TableColumnConfig,
} from "@agent-native/toolkit/dashboard/sql-dashboard-types";
import { IconRefresh } from "@tabler/icons-react";
import {
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider as HoverTooltipProvider } from "@/components/ui/tooltip";
import { createDemoChartTrendRows } from "@/lib/demo-chart-trend";
import { useSqlQuery, type SqlQueryResult } from "@/lib/sql-query";
import { serializePanelSql } from "@/pages/adhoc/sql-dashboard/panel-sql";

import { ANALYTICS_CHART_HOST } from "./analytics-chart-host";
import { DashboardPanelSkeleton } from "./DashboardPanelSkeleton";
import {
  extensionPanelHeightKey,
  initialExtensionPanelHeight,
  rememberExtensionPanelHeight,
} from "./extension-panel-height";
import {
  useIsStaleResult,
  useRefreshConfirmation,
  type PanelFreshness,
} from "./panel-freshness";
import { PanelFreshnessClock } from "./PanelFreshnessClock";

export * from "@agent-native/toolkit/app/dashboard-charts/panel-chart";
export {
  DashboardPanelDescription,
  renderDashboardMarkdownLink,
  safeDashboardLinkHref,
} from "@agent-native/toolkit/app/dashboard-charts/DashboardPanelDescription";

export { limitChartRows };
export { isNumericColumnFormat } from "@agent-native/toolkit/dashboard/table-columns";

/**
 * Draws one dashboard panel with toolkit's dashboard chart components, which
 * get Analytics' key dates, data notes and session replay links from
 * `ANALYTICS_CHART_HOST`.
 */
export function SqlChart(props: SqlChartProps) {
  return (
    <DashboardPanelChartHostProvider value={ANALYTICS_CHART_HOST}>
      <SqlChartContent {...props} />
    </DashboardPanelChartHostProvider>
  );
}

function TableLoadingSkeleton({ heatmap }: { heatmap: boolean }) {
  const columnWidths = ["w-24", "w-32", "w-20", "w-28"];
  const rows = heatmap ? HEATMAP_SKELETON_ROWS : TABLE_SKELETON_ROWS;

  return (
    <div
      data-dashboard-report-loading="true"
      className={`w-full flex-1 space-y-1 ${
        heatmap
          ? HEATMAP_PANEL_MIN_HEIGHT_CLASS
          : TABLE_PLACEHOLDER_MIN_HEIGHT_CLASS
      }`}
    >
      <div className="relative overflow-x-auto">
        <div className="min-w-[480px]">
          <div className="grid h-8 grid-cols-4 items-center border-b border-border px-2">
            {columnWidths.map((width, index) => (
              <DashboardPanelSkeleton key={index} className={`h-3 ${width}`} />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, row) => (
            <div
              key={row}
              className="grid h-8 grid-cols-4 items-center border-b border-border/50 px-2"
            >
              {columnWidths.map((width, col) => (
                <DashboardPanelSkeleton
                  key={col}
                  className={`h-3 ${
                    col === 0 ? "w-36" : col === 2 ? "ml-auto w-16" : width
                  }`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-8 items-center justify-between border-t border-border px-1 text-xs">
        <DashboardPanelSkeleton className="h-3 w-28" />
        <DashboardPanelSkeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

function SqlChartLoadingSkeleton({ panel }: { panel: SqlPanel }) {
  const fill = useContext(ChartFillHeightContext);

  if (panel.chartType === "metric") {
    return (
      <DashboardPanelSkeleton
        data-dashboard-report-loading="true"
        className="w-full flex-1 min-h-12"
      />
    );
  }

  if (isTableLikeChartType(panel.chartType)) {
    return <TableLoadingSkeleton heatmap={panel.chartType === "heatmap"} />;
  }

  const reserveLegend = chartTypeReservesLegend(panel);

  if (!reserveLegend) {
    return (
      <DashboardPanelSkeleton
        data-dashboard-report-loading="true"
        className={`w-full flex-1 ${fill ? "h-full min-h-[250px]" : "min-h-[250px]"}`}
      />
    );
  }

  return (
    <div
      data-dashboard-report-loading="true"
      className={`flex w-full flex-1 flex-col overflow-hidden ${fill ? "h-full" : ""}`}
    >
      <DashboardPanelSkeleton
        className={`w-full ${fill ? "h-full min-h-[250px] flex-1" : "h-[250px]"}`}
      />
      <div className="mt-1 flex min-h-6 flex-wrap gap-x-3 gap-y-1 overflow-hidden pr-1">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex min-h-6 items-center gap-1.5">
            <DashboardPanelSkeleton className="h-2.5 w-3 shrink-0 rounded-sm" />
            <DashboardPanelSkeleton className="h-3 w-20 min-w-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SqlChartProps {
  panel: SqlPanel;
  onDatumClick?: DatumClickHandler;
  resolvedSql?: string;
  className?: string;
  loadData?: boolean;
  resultOverride?: SqlQueryResult;
  showLoadingWhenDisabled?: boolean;
  /**
   * `loadData: false` means the panel is only offscreen, so its last result
   * stays on screen, marked as the previous filters when its SQL has changed,
   * instead of the skeleton.
   */
  retainWhileOffscreen?: boolean;
  timeRange?: number;
  reportScreenshot?: boolean;
  refreshToken?: number;
  onRefreshRequested?: () => void;
  onExportCsvChange?: (handler: (() => void) | null) => void;
  /**
   * The freshness of the result on screen, for a host that shows it outside
   * the chart; null when no result is shown, and again when the chart unmounts.
   */
  onFreshnessChange?: (freshness: PanelFreshness | null) => void;
  onCopyTableChange?: (handler: (() => Promise<void>) | null) => void;
  /** Passing this makes a table's columns editable; omit it for read-only tables. */
  onSaveColumns?: (columns: TableColumnConfig[]) => void;
  /** One viewer's own column widths, drawn over the panel's saved ones. */
  columnWidths?: Record<string, number>;
  /**
   * Passing this lets a viewer drag column widths for themselves; the drag
   * calls this instead of `onSaveColumns`, and null resets the column.
   */
  onColumnWidthChange?: (columnKey: string, width: number | null) => void;
  /** Passing this makes a table's rows clickable; it gets the row and the rows in shown order. */
  onTableRowClick?: TableRowClickHandler;
  isTableRowActive?: (row: Record<string, unknown>) => boolean;
  dashboardId?: string;
  extensionContext?: Record<string, unknown> | null;
}

/**
 * `rows` are the table's rows in display order; `resultRows` are every row
 * the query returned, before `config.limit`, and `resultTruncated` says the
 * query itself returned only part of its rows.
 */
export type TableRowClickHandler = (
  row: Record<string, unknown>,
  rows: Record<string, unknown>[],
  resultRows: Record<string, unknown>[],
  resultTruncated: boolean,
) => void;

function SqlChartContent({
  panel,
  resolvedSql,
  loadData = true,
  resultOverride,
  showLoadingWhenDisabled = true,
  retainWhileOffscreen = false,
  timeRange,
  reportScreenshot = false,
  refreshToken = 0,
  onRefreshRequested,
  onExportCsvChange,
  onFreshnessChange,
  onCopyTableChange,
  onSaveColumns,
  columnWidths,
  onColumnWidthChange,
  onTableRowClick,
  isTableRowActive,
  dashboardId,
  extensionContext,
  onDatumClick,
}: SqlChartProps) {
  const t = useT();
  const { enabled: demoModeEnabled } = useDemoModeStatus();
  const isSection = panel.chartType === "section";
  const isExtension = panel.chartType === "extension";
  const shouldQuery = !isSection && !isExtension && loadData && !resultOverride;
  const sql = serializePanelSql(resolvedSql ?? panel.sql);
  const [localRefreshToken, setLocalRefreshToken] = useState(0);
  // Only a pivot reads the time range, so only a pivot's rows depend on it.
  const pivotTimeRange = panel.config?.pivot ? (timeRange ?? null) : null;
  const retainPreviousScope = useMemo(
    () =>
      JSON.stringify([
        dashboardId ?? null,
        panel.id,
        panel.source,
        panel.chartType,
        panel.config ?? null,
        pivotTimeRange,
      ]),
    [
      dashboardId,
      panel.id,
      panel.source,
      panel.chartType,
      panel.config,
      pivotTimeRange,
    ],
  );
  const {
    data: queryResult,
    isLoading: queryIsLoading,
    isFetching: queryIsFetching,
    isPlaceholderData: queryIsPlaceholderData,
    error: queryError,
    freshness: queryFreshness,
    completedManualRefreshToken,
  } = useSqlQuery(
    ["sql-chart", dashboardId || panel.id, sql, panel.source],
    sql,
    panel.source,
    {
      enabled: shouldQuery,
      reportScreenshot,
      refreshToken: refreshToken + localRefreshToken,
      retainPreviousScope,
      retainWhilePaused: retainWhileOffscreen,
      reuseCompletedOnEnable: retainWhileOffscreen,
      snapshots: !isSection && !isExtension && !resultOverride,
    },
  );

  const result = resultOverride ?? queryResult;
  const isLoading = resultOverride ? false : queryIsLoading;
  const rawRows = result?.rows ?? [];
  // The last completed result, including a result with no rows, stays on
  // screen while the next query runs. Only a first load, or a retry of a
  // failure with nothing to show, has no result to keep and shows the skeleton.
  const isUpdating =
    !resultOverride &&
    queryIsFetching &&
    queryResult !== undefined &&
    (rawRows.length > 0 || !queryError);
  const isShowingPreviousFilters =
    !resultOverride && queryResult !== undefined && queryIsPlaceholderData;
  const isPausedOnPreviousFilters =
    !resultOverride &&
    retainWhileOffscreen &&
    !loadData &&
    queryResult !== undefined &&
    queryIsPlaceholderData;
  const isFetching = resultOverride ? false : queryIsFetching && !isUpdating;
  const error =
    rawRows.length === 0
      ? (result?.error ??
        (queryError ? formatSqlChartError(queryError) : undefined))
      : undefined;
  const refreshError =
    shouldQuery && rawRows.length > 0 && queryError && !isUpdating
      ? formatSqlChartError(queryError)
      : undefined;
  const requestRefresh = () => {
    if (onRefreshRequested) onRefreshRequested();
    else setLocalRefreshToken((token) => token + 1);
  };

  const plan = useMemo(
    () => planPanelRender(rawRows, panel, { timeRange }),
    [rawRows, panel.chartType, panel.config, timeRange],
  );
  const { rows: queryRows, xKey, yKeys } = plan;
  const shouldCreateDemoTrend =
    demoModeEnabled &&
    (panel.chartType === "line" ||
      panel.chartType === "area" ||
      (panel.chartType as string) === "stacked-area");
  const rows = useMemo(
    () =>
      shouldCreateDemoTrend
        ? createDemoChartTrendRows(queryRows, yKeys, panel.id)
        : queryRows,
    [queryRows, yKeys, panel.id, shouldCreateDemoTrend],
  );
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

  const showsRetainedResult = retainWhileOffscreen && queryResult !== undefined;
  const showsSkeleton =
    isLoading ||
    isFetching ||
    (!loadData && showLoadingWhenDisabled && !showsRetainedResult);
  // A result handed in by the caller was not fetched by this panel's query.
  const shownFreshness = resultOverride ? undefined : queryFreshness;
  const isStale = useIsStaleResult(shownFreshness?.fetchedAt);
  const refreshConfirmed = useRefreshConfirmation({
    requestToken: refreshToken + localRefreshToken,
    scopeKey: JSON.stringify([
      dashboardId ?? null,
      panel.id,
      panel.source,
      sql,
    ]),
    completedToken: completedManualRefreshToken,
  });
  const canReportFreshness =
    !isSection && !isExtension && !resultOverride && !error && !showsSkeleton;
  const reportedCache = shownFreshness?.cache;
  const reportedFetchedAt = shownFreshness?.fetchedAt;
  const reportedStatus: PanelFreshness["status"] = isUpdating
    ? isShowingPreviousFilters
      ? "previous-filters-updating"
      : "updating"
    : isPausedOnPreviousFilters
      ? "previous-filters"
      : refreshConfirmed
        ? "refreshed"
        : isStale
          ? "stale"
          : undefined;
  useEffect(() => {
    if (!onFreshnessChange) return;
    onFreshnessChange(
      canReportFreshness && (reportedCache || reportedStatus)
        ? {
            fetchedAt: reportedFetchedAt,
            cache: reportedCache ?? "unknown",
            ...(reportedStatus ? { status: reportedStatus } : {}),
          }
        : null,
    );
    return () => onFreshnessChange(null);
  }, [
    onFreshnessChange,
    canReportFreshness,
    reportedCache,
    reportedFetchedAt,
    reportedStatus,
  ]);

  if (isSection) {
    return (
      <div className="px-1 py-2">
        <DashboardPanelDescription
          description={panel.config?.description}
          className="text-xs leading-relaxed text-muted-foreground"
        />
      </div>
    );
  }

  if (isExtension) {
    const extensionId = panel.config?.extensionId;
    const slotId = panel.config?.extensionSlotId;
    if (!extensionId && !slotId) {
      return (
        <div className="flex flex-1 items-center justify-center px-4 py-8 min-h-[120px]">
          <p className="text-sm text-muted-foreground text-center">
            {t("sqlDashboard.extensionMissingId")}
          </p>
        </div>
      );
    }
    const heightKey = extensionPanelHeightKey(
      dashboardId,
      panel.id,
      extensionId,
    );
    // Keyed so a panel that switches dashboard or extension remounts at that
    // extension's own starting height, not the previous one's.
    return (
      <DashboardExtensionPanel
        key={heightKey}
        heightKey={heightKey}
        extensionId={extensionId}
        panelId={panel.id}
        slotId={slotId}
        context={extensionContext}
      />
    );
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

  const isMetric = panel.chartType === "metric";
  const isTableLike = isTableLikeChartType(panel.chartType);
  const placeholderMinH = isMetric
    ? "min-h-12"
    : panel.chartType === "heatmap"
      ? HEATMAP_PANEL_MIN_HEIGHT_CLASS
      : isTableLike
        ? TABLE_PLACEHOLDER_MIN_HEIGHT_CLASS
        : "min-h-[250px]";
  const placeholderPadY = isMetric ? "py-2" : "py-8";

  if (showsSkeleton) {
    return <SqlChartLoadingSkeleton panel={panel} />;
  }

  if (error) {
    return (
      <div
        className={`flex flex-1 flex-col items-center justify-center gap-3 px-4 ${placeholderPadY} ${placeholderMinH}`}
        role="alert"
      >
        <p className="text-center text-sm text-destructive break-words">
          {formatSqlChartError(error)}
        </p>
        {loadData ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={requestRefresh}
          >
            <IconRefresh className="mr-2 h-3.5 w-3.5" />
            {t("sqlDashboard.refresh")}
          </Button>
        ) : null}
      </div>
    );
  }

  const missingConfigKeys = plan.missingKeys;
  const withConfigBanners = (node: ReactNode) => {
    let content = node;
    if (refreshError) {
      content = (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            role="alert"
          >
            <p className="min-w-0 break-words text-xs text-destructive">
              {isShowingPreviousFilters ? (
                <span className="font-medium">
                  {t("sqlDashboard.previousFilters")}
                  {" · "}
                </span>
              ) : null}
              {refreshError}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={requestRefresh}
            >
              <IconRefresh className="mr-2 h-3.5 w-3.5" />
              {t("sqlDashboard.refresh")}
            </Button>
          </div>
          {missingConfigKeys.length > 0 ? (
            <ConfigWarning keys={missingConfigKeys} />
          ) : null}
          <div className="min-h-0 flex-1">{node}</div>
        </div>
      );
    } else if (missingConfigKeys.length > 0) {
      content = (
        <div className="space-y-2">
          <ConfigWarning keys={missingConfigKeys} />
          {node}
        </div>
      );
    }

    if (
      typeof panel.config?.description !== "string" ||
      !panel.config.description
    ) {
      return content;
    }

    return (
      <div className="flex h-full min-h-0 flex-col gap-1.5">
        <DashboardPanelDescription
          description={panel.config.description}
          collapsible
          className="shrink-0 text-xs leading-relaxed text-muted-foreground"
        />
        <div className="min-h-0 flex-1">{content}</div>
      </div>
    );
  };

  const showStandaloneStatus =
    !onFreshnessChange &&
    (shownFreshness !== undefined || reportedStatus !== undefined);
  const withNotice = (node: ReactNode) => (
    <div
      className={
        showStandaloneStatus
          ? "grid h-full min-h-0 grid-cols-[minmax(0,1fr)_1.5rem] items-start gap-x-1"
          : "flex h-full min-h-0 flex-col"
      }
    >
      <div data-dashboard-report-chart-body className="h-full min-h-0 min-w-0">
        {node}
      </div>
      {showStandaloneStatus ? (
        <div data-dashboard-report-standalone-status className="min-w-0">
          <HoverTooltipProvider>
            <PanelFreshnessClock
              freshness={{
                cache: "unknown",
                ...shownFreshness,
                status: reportedStatus,
              }}
              className="h-6 w-6 p-1"
            />
          </HoverTooltipProvider>
        </div>
      ) : null}
    </div>
  );
  const withConfigWarning = (node: ReactNode) =>
    withNotice(withConfigBanners(node));

  const pointLimit = plan.pointLimit;
  const withPointLimit = (node: ReactNode) =>
    pointLimit ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">{node}</div>
        <ChartPointLimitNote limit={pointLimit} />
      </div>
    ) : (
      node
    );

  if (plan.empty) {
    const noData = (
      <div
        className={`flex h-full flex-1 items-center justify-center ${placeholderPadY} ${placeholderMinH}`}
      >
        <p className="text-sm text-muted-foreground text-center">
          {t("common.noData")}
        </p>
      </div>
    );
    // A funnel or heatmap with rows that draws nothing keeps the warning and
    // refresh banner that say why; a result with no rows to plot is a bare
    // "No data".
    return plan.rows.length === 0
      ? withNotice(noData)
      : withConfigWarning(noData);
  }

  if (chartType === "metric") {
    return withConfigWarning(<MetricRenderer rows={rows} panel={panel} />);
  }

  if (chartType === "table") {
    return withConfigWarning(
      <TableRenderer
        rows={rows}
        panel={panel}
        onExportCsvChange={onExportCsvChange}
        onCopyTableChange={onCopyTableChange}
        onSaveColumns={onSaveColumns}
        columnWidths={columnWidths}
        onColumnWidthChange={onColumnWidthChange}
        // Rows kept from the previous filters while new ones load belong to
        // no current scope, so they open nothing.
        onRowClick={
          onTableRowClick && !isShowingPreviousFilters
            ? (row, displayRows, resultRows) =>
                onTableRowClick(
                  row,
                  displayRows,
                  resultRows,
                  result?.truncated === true,
                )
            : undefined
        }
        isRowActive={isTableRowActive}
      />,
    );
  }

  if (chartType === "pie") {
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
  }

  if (chartType === "bar") {
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
  }

  if (chartType === "combo") {
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
  }

  if (chartType === "funnel" && plan.funnel) {
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
  }

  if (chartType === "heatmap" && plan.heatmap) {
    return withConfigWarning(
      withPointLimit(
        <HeatmapRenderer rows={chartRows} panel={panel} keys={plan.heatmap} />,
      ),
    );
  }

  if (chartType === "callout") {
    return withConfigWarning(
      withPointLimit(<CalloutRenderer rows={chartRows} />),
    );
  }

  if (chartType !== "line" && chartType !== "area") {
    return withConfigWarning(<TableRenderer rows={rows} panel={panel} />);
  }

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

function DashboardExtensionPanel({
  extensionId,
  panelId,
  slotId,
  context,
  heightKey,
}: {
  extensionId?: string;
  panelId: string;
  slotId?: string;
  context?: Record<string, unknown> | null;
  heightKey: string;
}) {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // The full-screen view is wider, so its content wraps to a different height;
  // it remembers its own rather than overwriting the card's.
  const fullScreen = useContext(ChartFillHeightContext);
  const storageKey = fullScreen ? `${heightKey}:full-screen` : heightKey;
  const [initialHeight] = useState(() =>
    initialExtensionPanelHeight(storageKey),
  );
  const loadingSkeleton = !ready ? (
    <DashboardPanelSkeleton
      data-dashboard-extension-loading="true"
      className="absolute inset-0 z-10 h-full w-full rounded-md"
      aria-hidden="true"
    />
  ) : null;

  if (slotId) {
    return (
      <div
        className="relative min-h-[180px] w-full"
        aria-busy={!ready}
        data-dashboard-report-loading={ready ? undefined : "true"}
      >
        {loadingSkeleton}
        <div className={ready ? "opacity-100" : "opacity-0"}>
          <ExtensionSlot
            id={slotId}
            context={context}
            showEmptyAffordance
            onReady={() => setReady(true)}
            className="min-h-[120px] w-full"
            toolClassName="w-full"
          />
        </div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 min-h-[120px]">
        <p className="text-sm text-muted-foreground text-center">
          {t("sqlDashboard.extensionUnavailable")}
        </p>
      </div>
    );
  }

  // The panel is as tall as the height the iframe reports, even a single line;
  // until then it holds its last reported height.
  return (
    <div
      className="relative w-full"
      style={ready ? undefined : { minHeight: initialHeight }}
      aria-busy={!ready}
      data-dashboard-report-loading={ready ? undefined : "true"}
    >
      {loadingSkeleton}
      <EmbeddedExtension
        extensionId={extensionId!}
        slotId={`dashboard-panel-${panelId}`}
        context={context}
        className={ready ? "w-full opacity-100" : "w-full opacity-0"}
        initialHeight={initialHeight}
        onHeightChange={(height) =>
          rememberExtensionPanelHeight(storageKey, height)
        }
        onReady={() => setReady(true)}
        onUnavailable={() => {
          setReady(true);
          setUnavailable(true);
        }}
      />
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
