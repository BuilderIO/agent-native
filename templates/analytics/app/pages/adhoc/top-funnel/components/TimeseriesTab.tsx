import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { DynamicChart } from "./DynamicChart";
import { TextFilter } from "./TextFilter";
import { timeseriesQuery } from "../queries";
import type { DateCadence } from "../types";
import { DATE_CADENCE_OPTIONS } from "../types";
import { useUrlFilterState } from "../useUrlFilterState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FILTER_DEFS = {
  baseUrlContains: { type: "string" as const, default: "figma-to-angular" },
  cadence: { type: "string" as const, default: "Weekly" },
};

export function TimeseriesTab() {
  const [f, setF] = useUrlFilterState(FILTER_DEFS, "t4");

  const cadence = f.cadence as DateCadence;

  const sql = useMemo(
    () => timeseriesQuery(f.baseUrlContains, cadence),
    [f.baseUrlContains, cadence],
  );

  const { data, isLoading } = useMetricsQuery(["ts-series", sql], sql, {
    enabled: f.baseUrlContains.length > 2,
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Filters
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <TextFilter
            label="Base URL Contains"
            value={f.baseUrlContains}
            onChange={(v) => setF("baseUrlContains", v)}
            placeholder="e.g. figma-to-angular"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Cadence
            </label>
            <Select value={f.cadence} onValueChange={(v) => setF("cadence", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_CADENCE_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {f.baseUrlContains.length <= 2 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Enter a URL pattern (3+ characters) to see timeseries data
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DynamicChart
            title="New Visitors by ICP Status"
            rows={rows}
            valueKey="new_visitors"
            chartType="stacked-bar"
            isLoading={isLoading}
            error={data?.error}
          />
          <DynamicChart
            title="Signups by ICP Status"
            rows={rows}
            valueKey="signups"
            chartType="stacked-bar"
            isLoading={isLoading}
            error={data?.error}
          />
        </div>
      )}
    </div>
  );
}
