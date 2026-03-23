import { useMemo } from "react";
import { useMetricsQuery } from "@/lib/query-metrics";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { referrerSubChannelQuery } from "../queries";
import { formatNumber } from "../types";

interface ReferrerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "visitors" | "signups";
  filters: {
    dateStart: string;
    dateEnd: string;
    pageType: string[];
    channel: string[];
    referrer: string[];
    baseUrl: string[];
    subPageType: string[];
    urlFilter?: string;
  };
}

export function ReferrerModal({
  open,
  onOpenChange,
  type,
  filters,
}: ReferrerModalProps) {
  const sql = useMemo(() => referrerSubChannelQuery(filters), [filters]);

  const { data, isLoading } = useMetricsQuery(
    ["referrer-modal", type, sql],
    sql,
    { enabled: open },
  );

  const sortedRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const sortKey = type === "visitors" ? "new_visitors" : "signups";
    return [...rows].sort(
      (a, b) => Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0),
    );
  }, [data, type]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {type === "visitors" ? "Visitors" : "Signups"} by Referrer Sub
            Channel
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-auto max-h-[60vh]">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : data?.error ? (
            <p className="text-sm text-red-400 py-4 text-center">
              {data.error}
            </p>
          ) : sortedRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No data
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                    Referrer Sub Channel
                  </th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">
                    Visitors
                  </th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">
                    Signups
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/30 hover:bg-muted/30"
                  >
                    <td className="py-1.5 px-2 truncate max-w-[200px]">
                      {String(row.referrer_sub_channel ?? "(none)")}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatNumber(Number(row.new_visitors ?? 0))}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatNumber(Number(row.signups ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
