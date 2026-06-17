import { IconDatabase } from "@tabler/icons-react";
import { DataChartWidget } from "./DataChartWidget.js";
import { DataTableWidget } from "./DataTableWidget.js";
import type { DataWidgetResult } from "./data-widget-types.js";

function SummaryPill({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xs font-medium text-foreground">
        {typeof value === "number" ? value.toLocaleString() : String(value)}
      </div>
    </div>
  );
}

export function DataInsightsWidget({ result }: { result: DataWidgetResult }) {
  const title = result.display?.title ?? result.title ?? "Data insights";
  const summary = result.summary ?? {};

  return (
    <div className="my-1.5 space-y-2">
      <div className="rounded-lg border border-border bg-background p-3 text-foreground shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <IconDatabase className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            {result.display?.description ? (
              <div className="text-xs text-muted-foreground">
                {result.display.description}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(summary)
            .filter(([, value]) => typeof value !== "object")
            .slice(0, 4)
            .map(([key, value]) => (
              <SummaryPill key={key} label={key} value={value} />
            ))}
        </div>
      </div>
      {result.chartSeries ? (
        <DataChartWidget chart={result.chartSeries} />
      ) : null}
      {result.table ? (
        <DataTableWidget
          table={result.table}
          action={result.display?.primaryAction}
        />
      ) : null}
    </div>
  );
}
