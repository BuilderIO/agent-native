import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { subscriptionsQuery } from "./queries";
import { TablePagination, usePagination } from "./TablePagination";

interface SubscriptionDetailsProps {
  companyName: string;
}

export function SubscriptionDetails({ companyName }: SubscriptionDetailsProps) {
  const sql = useMemo(() => subscriptionsQuery(companyName), [companyName]);
  const { data, isLoading } = useMetricsQuery(["ch-subs", companyName], sql);
  const rows = data?.rows ?? [];
  const { page, totalPages, pageItems, setPage } = usePagination(rows);

  const formatArr = (val: unknown) => {
    const num = Number(val);
    if (!num) return "—";
    return `$${num.toLocaleString()}`;
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Subscriptions & Spaces</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          All spaces and subscription details
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : data?.error ? (
          <p className="text-sm text-red-400 py-4 text-center">{data.error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No subscriptions found</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Plan</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Status</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">ARR</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Start Date</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Space ID</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Root ID</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((row, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-2">{String(row.plan ?? "—")}</td>
                      <td className="py-1.5 px-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            String(row.status) === "active"
                              ? "bg-green-500/10 text-green-500"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {String(row.status ?? "—")}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{formatArr(row.subscription_arr)}</td>
                      <td className="py-1.5 px-2">{String(row.start_date ?? "—")}</td>
                      <td className="py-1.5 px-2 font-mono text-[10px] truncate max-w-[140px]">{String(row.space_id ?? "—")}</td>
                      <td className="py-1.5 px-2 font-mono text-[10px] truncate max-w-[140px]">{String(row.root_id ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
