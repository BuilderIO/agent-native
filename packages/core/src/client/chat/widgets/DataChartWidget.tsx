import { lazy, Suspense, useEffect, useState } from "react";
import { IconChartBar } from "@tabler/icons-react";
import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

const LazyDataChartRenderer = lazy(() =>
  import("./DataChartRenderer.js").then((module) => ({
    default: module.DataChartRenderer,
  })),
);

export function DataChartWidget({ chart }: { chart: DataChartWidgetData }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fallback = (
    <div className="flex h-60 items-center justify-center rounded-md bg-muted/30 text-xs text-muted-foreground">
      Chart
    </div>
  );

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconChartBar className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {chart.title ?? "Data chart"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {chart.data.length.toLocaleString()} point
            {chart.data.length === 1 ? "" : "s"}
            {chart.sampled ? " sampled" : ""}
          </div>
        </div>
      </div>
      <div className="p-3">
        {!mounted ? (
          fallback
        ) : (
          <Suspense fallback={fallback}>
            <LazyDataChartRenderer chart={chart} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
