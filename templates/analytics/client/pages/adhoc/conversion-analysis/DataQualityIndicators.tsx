import { useMetricsQuery } from "@/lib/query-metrics";
import { getDataQualityQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SqlCodeToggle } from "./SqlCodeToggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface DataQualityIndicatorsProps {
  months: number;
}

interface QualityRow {
  week: string;
  total_pageviews: number;
  unique_visitors: number;
  null_visitor_pct: number;
  null_session_pct: number;
  null_channel_pct: number;
  quality_flag: string;
}

export function DataQualityIndicators({ months }: DataQualityIndicatorsProps) {
  const sqlQuery = getDataQualityQuery(months);
  const { data, isLoading, error } = useMetricsQuery(
    ["data-quality", String(months)],
    sqlQuery,
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Quality Check</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">
            Error loading quality data: {data?.error || String(error)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Quality Check</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows as unknown as QualityRow[];
  const hasWarnings = rows.some((r) => r.quality_flag === "Warning");

  const formatDate = (value: string) => {
    try {
      const d = new Date(value);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return String(value);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Data Quality Check</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Tracking completeness over the last {months} months (recent 12
              weeks shown)
            </p>
          </div>
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${hasWarnings ? "bg-destructive/10 text-destructive" : "bg-green-100 text-green-700"}`}
          >
            {hasWarnings ? (
              <>
                <AlertTriangle className="h-4 w-4" />
                <span>Issues Detected</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>All Clear</span>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week</TableHead>
              <TableHead className="text-right">Pageviews</TableHead>
              <TableHead className="text-right">Visitors</TableHead>
              <TableHead className="text-right">NULL Visitor %</TableHead>
              <TableHead className="text-right">NULL Session %</TableHead>
              <TableHead className="text-right">NULL Channel %</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.week}
                className={
                  row.quality_flag === "Warning" ? "bg-destructive/5" : ""
                }
              >
                <TableCell className="font-medium">
                  {formatDate(row.week)}
                </TableCell>
                <TableCell className="text-right">
                  {row.total_pageviews.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {row.unique_visitors.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      row.null_visitor_pct > 5
                        ? "text-destructive font-semibold"
                        : ""
                    }
                  >
                    {row.null_visitor_pct.toFixed(2)}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      row.null_session_pct > 5
                        ? "text-destructive font-semibold"
                        : ""
                    }
                  >
                    {row.null_session_pct.toFixed(2)}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      row.null_channel_pct > 20
                        ? "text-orange-600 font-semibold"
                        : ""
                    }
                  >
                    {row.null_channel_pct.toFixed(2)}%
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  {row.quality_flag === "Warning" ? (
                    <span className="inline-flex items-center gap-1 text-destructive text-xs">
                      <AlertTriangle className="h-3 w-3" />
                      Warning
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                      <CheckCircle2 className="h-3 w-3" />
                      OK
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
          <p>
            <strong>What this checks:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              NULL visitor/session IDs indicate tracking implementation issues
            </li>
            <li>
              High NULL rates (&gt;5%) mean conversion data may be unreliable
            </li>
            <li>NULL channel rates show attribution data completeness</li>
          </ul>
          {hasWarnings && (
            <p className="text-destructive font-semibold mt-2">
              ⚠️ Data quality issues detected. The conversion decline may be a
              measurement problem, not an actual behavioral change.
            </p>
          )}
        </div>

        <SqlCodeToggle sql={sqlQuery} title="View SQL Query" />
      </CardContent>
    </Card>
  );
}
