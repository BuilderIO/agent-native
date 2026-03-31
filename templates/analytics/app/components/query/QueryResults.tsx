import { useState, useMemo } from "react";
import { DataTable } from "@/components/dashboard/DataTable";
import { TimeSeriesChart } from "@/components/dashboard/TimeSeriesChart";
import { Button } from "@/components/ui/button";
import { IconTable, IconChartBar } from "@tabler/icons-react";

interface QueryResultsProps {
  data: Record<string, unknown>[];
  isLoading?: boolean;
  error?: string;
}

export function QueryResults({ data, isLoading, error }: QueryResultsProps) {
  const [view, setView] = useState<"table" | "chart">("table");

  // Auto-detect time series columns
  const timeSeriesConfig = useMemo(() => {
    if (data.length === 0) return null;
    const keys = Object.keys(data[0]);
    const timeKey = keys.find(
      (k) =>
        k.toLowerCase().includes("day") ||
        k.toLowerCase().includes("time") ||
        k.toLowerCase().includes("date"),
    );
    const valueKey = keys.find(
      (k) => k !== timeKey && typeof data[0][k] === "number",
    );
    if (timeKey && valueKey) return { xKey: timeKey, yKey: valueKey };
    return null;
  }, [data]);

  if (!data.length && !isLoading && !error) return null;

  return (
    <div className="space-y-3">
      {data.length > 0 && timeSeriesConfig && (
        <div className="flex items-center gap-1">
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setView("table")}
          >
            <IconTable className="h-4 w-4 mr-1" />
            Table
          </Button>
          <Button
            variant={view === "chart" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setView("chart")}
          >
            <IconChartBar className="h-4 w-4 mr-1" />
            Chart
          </Button>
        </div>
      )}

      {view === "chart" && timeSeriesConfig ? (
        <TimeSeriesChart
          title="Query Results"
          data={[...data].reverse()}
          xKey={timeSeriesConfig.xKey}
          yKey={timeSeriesConfig.yKey}
          isLoading={isLoading}
          error={error}
        />
      ) : (
        <DataTable
          data={data}
          isLoading={isLoading}
          error={error}
          maxRows={200}
        />
      )}

      {data.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.length} row{data.length !== 1 ? "s" : ""} returned
        </p>
      )}
    </div>
  );
}
