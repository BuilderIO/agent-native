import { useT } from "@agent-native/core/client/i18n";
import { DATA_WIDGET_MAX_CHART_POINTS } from "@agent-native/core/data-widgets";
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";

import type { AgentChatDataChartLayout } from "../../../agentkit/react/data-chart-layout.js";
import type {
  DataChartWidget as DataChartWidgetData,
  DataWidgetDisplay,
} from "./data-widget-types.js";
import {
  DataWidgetDisplayControls,
  DataWidgetSourceChips,
} from "./DataWidgetDisplayControls.js";

const LazyDataChartRenderer = lazy(() =>
  import("./DataChartRenderer.js").then((module) => ({
    default: module.DataChartRenderer,
  })),
);

export function DataChartWidget({
  chart,
  display,
  layout,
}: {
  chart: DataChartWidgetData;
  display?: DataWidgetDisplay;
  layout?: AgentChatDataChartLayout;
}) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const contentHeight = chart.contentHeight;
  const contentPadding = chart.contentPadding ?? 0;
  const hasOmittedRows =
    chart.sampled === true ||
    chart.truncated === true ||
    chart.data.length > DATA_WIDGET_MAX_CHART_POINTS;
  const maxWidth = layout?.maxWidth;
  if (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0)) {
    throw new RangeError(
      "dataChartLayout.maxWidth must be a positive CSS length",
    );
  }
  const cardStyle: CSSProperties | undefined =
    maxWidth === undefined
      ? undefined
      : { width: "100%", maxWidth: `${maxWidth}px`, marginInline: "auto" };

  useEffect(() => {
    setMounted(true);
  }, []);

  const fallback = (
    <div
      className={`box-border flex w-full items-center justify-center rounded-md bg-muted/30 text-xs text-muted-foreground ${contentHeight ? "" : "aspect-[16/9]"}`}
      style={
        contentHeight !== undefined || contentPadding > 0
          ? {
              ...(contentHeight !== undefined
                ? { height: `${contentHeight}px` }
                : {}),
              padding: `${contentPadding}px`,
            }
          : undefined
      }
    >
      {t("agentChat.widget.chart")}
    </div>
  );

  return (
    <div
      className="my-4 overflow-hidden rounded-[3px] border border-border bg-background text-foreground shadow-sm"
      style={cardStyle}
    >
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <div
          className={`min-w-0 flex-1 truncate text-sm font-medium ${layout?.titleTone === "muted" ? "text-muted-foreground" : ""}`}
          style={{
            fontFamily: layout?.titleFontFamily,
            fontSize:
              layout?.titleFontSize === undefined
                ? undefined
                : `${layout.titleFontSize}px`,
            fontWeight: layout?.titleFontWeight,
            lineHeight:
              layout?.titleLineHeight === undefined
                ? undefined
                : `${layout.titleLineHeight}px`,
            color:
              layout?.titleTone === "muted"
                ? "hsl(var(--muted-foreground))"
                : undefined,
          }}
        >
          {chart.title ?? t("agentChat.widget.dataChart")}
        </div>
        <DataWidgetDisplayControls
          display={display}
          chartActions={chart.actions}
          variant={layout?.actionsVariant ?? "secondary"}
        />
      </div>
      {!mounted ? (
        fallback
      ) : (
        <Suspense fallback={fallback}>
          <LazyDataChartRenderer chart={chart} layout={layout} />
        </Suspense>
      )}
      {hasOmittedRows ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground" role="status">
          {t("agentChat.widget.chartRowsOmitted")}
        </p>
      ) : null}
      <DataWidgetSourceChips sources={display?.sources ?? []} />
    </div>
  );
}
