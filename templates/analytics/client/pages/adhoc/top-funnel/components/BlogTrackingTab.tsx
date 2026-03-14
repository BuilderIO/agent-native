import { useState, useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SingleDateInput } from "./DateRangeInput";
import { blogTrackingQuery } from "../queries";
import { formatNumber } from "../types";
import { useUrlFilterState } from "../useUrlFilterState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FILTER_DEFS = {
  pageType: { type: "string" as const, default: "blog" },
  minDate: { type: "string" as const, default: "2026-01-01" },
};

export function BlogTrackingTab() {
  const [f, setF] = useUrlFilterState(FILTER_DEFS, "t5");

  const sql = useMemo(() => blogTrackingQuery(f.pageType, f.minDate), [f.pageType, f.minDate]);
  const { data, isLoading } = useMetricsQuery(["blog-tracking", sql], sql);

  const [sortCol, setSortCol] = useState("visitor_count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const raw = data?.rows ?? [];
    return [...raw]
      .sort((a, b) => {
        const aVal = a[sortCol];
        const bVal = b[sortCol];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        }
        return sortDir === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      })
      .slice(0, 300);
  }, [data, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  const columns = [
    { key: "base_url", label: "Base URL" },
    { key: "author", label: "Author" },
    { key: "visitor_count", label: "Visitors" },
    { key: "min_first_pageview_d", label: "First Seen" },
    { key: "type", label: "Type" },
    { key: "purpose", label: "Purpose" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Page Type</label>
            <Select value={f.pageType} onValueChange={(v) => setF("pageType", v)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blog" className="text-xs">blog</SelectItem>
                <SelectItem value="docs" className="text-xs">docs</SelectItem>
                <SelectItem value="marketing" className="text-xs">marketing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SingleDateInput label="Min First Pageview (on or after)" value={f.minDate} onChange={(v) => setF("minDate", v)} />
        </div>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Blog Page URLs — for reference</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : data?.error ? (
            <p className="text-sm text-red-400 py-4 text-center">{data.error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No data</p>
          ) : (
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className="text-left py-2 px-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none"
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="flex items-center gap-1">
                          {col.label}
                          <ArrowUpDown className={cn("h-3 w-3", sortCol === col.key ? "text-foreground" : "text-muted-foreground/30")} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-mono text-[11px] max-w-[300px] truncate">{String(row.base_url ?? "-")}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{String(row.author ?? "-")}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{formatNumber(Number(row.visitor_count ?? 0))}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{String(row.min_first_pageview_d ?? "-")}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{String(row.type ?? "-")}</td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{String(row.purpose ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
