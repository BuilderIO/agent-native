import { IconChartBar } from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { DEFAULT_LOCALE, useOptionalLocale, useT } from "../../i18n.js";
import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

const LazyDataChartRenderer = lazy(() =>
  import("./DataChartRenderer.js").then((module) => ({
    default: module.DataChartRenderer,
  })),
);

export function DataChartWidget({ chart }: { chart: DataChartWidgetData }) {
  const t = useT();
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fallback = (
    <div className="flex h-60 items-center justify-center rounded-md bg-muted/30 text-xs text-muted-foreground">
      {t("agentChat.widget.chart")}
    </div>
  );

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconChartBar className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {chart.title ?? t("agentChat.widget.dataChart")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("agentChat.widget.points", {
              count: chart.data.length,
              formattedCount: chart.data.length.toLocaleString(locale),
            })}
            {chart.sampled ? ` ${t("agentChat.widget.sampled")}` : ""}
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
