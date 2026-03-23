import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { statusBreakdownQuery } from "./queries";
import { cn } from "@/lib/utils";

const fmtFull = (v: number) =>
  `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const STATUS_COLORS: Record<string, string> = {
  New: "bg-emerald-500/15 text-emerald-500",
  Expansion: "bg-blue-500/15 text-blue-500",
  Reactivate: "bg-violet-500/15 text-violet-500",
  Churn: "bg-red-500/15 text-red-500",
  Downgrade: "bg-orange-500/15 text-orange-500",
};

const FALLBACK_COLOR = "bg-zinc-500/15 text-zinc-500";

interface StatusBreakdownProps {
  fiscalYear: number;
  productGroup?: string;
}

export function StatusBreakdown({
  fiscalYear,
  productGroup,
}: StatusBreakdownProps) {
  const sql = statusBreakdownQuery(fiscalYear, productGroup);
  const { data, isLoading } = useMetricsQuery(
    ["arr-status-breakdown", String(fiscalYear), productGroup ?? ""],
    sql,
  );

  const rows = useMemo(() => {
    return (data?.rows ?? []).map((r) => ({
      status: String(r.status ?? ""),
      status_group: String(r.status_group ?? ""),
      arr_change: Number(r.arr_change || 0),
      events: Number(r.events || 0),
      customers: Number(r.customers || 0),
    }));
  }, [data]);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Breakdown by Status</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : data?.error ? (
          <p className="text-sm text-red-400 text-center py-4">{data.error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No data
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                    Group
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    ARR Change
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    Events
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    Customers
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isPos = r.arr_change >= 0;
                  return (
                    <tr key={r.status} className="border-b border-border/50">
                      <td className="py-2 px-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                            STATUS_COLORS[r.status] ?? FALLBACK_COLOR,
                          )}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {r.status_group}
                      </td>
                      <td
                        className={cn(
                          "py-2 px-3 text-right font-medium",
                          isPos ? "text-emerald-500" : "text-red-500",
                        )}
                      >
                        {isPos ? "+" : ""}
                        {fmtFull(r.arr_change)}
                      </td>
                      <td className="py-2 px-3 text-right text-muted-foreground">
                        {r.events.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-muted-foreground">
                        {r.customers.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
