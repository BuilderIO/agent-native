import { useT } from "@agent-native/core/client/i18n";
import { DATA_WIDGET_MAX_CHART_POINTS } from "@agent-native/core/data-widgets";
import { lazy, Suspense, useEffect, useState } from "react";

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
}: {
  chart: DataChartWidgetData;
  display?: DataWidgetDisplay;
}) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const contentHeight = chart.contentHeight;
  const contentPadding = chart.contentPadding ?? 0;
  const hasOmittedRows =
    chart.sampled || chart.data.length > DATA_WIDGET_MAX_CHART_POINTS;

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
    <div className="my-4 overflow-hidden rounded-[3px] border border-border bg-background text-foreground shadow-sm">
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {chart.title ?? t("agentChat.widget.dataChart")}
        </div>
        <DataWidgetDisplayControls
          display={display}
          chartActions={chart.actions}
          variant="secondary"
        />
      </div>
      {!mounted ? (
        fallback
      ) : (
        <Suspense fallback={fallback}>
          <LazyDataChartRenderer chart={chart} />
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
