import { useMetricsQuery } from "@/lib/query-metrics";
import { getLandingPageQuery } from "./queries";
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
import { ArrowDown, ArrowUp } from "lucide-react";

interface LandingPageTableProps {
  weeksRecent: number;
  weeksBaseline: number;
}

interface LandingRow {
  landing_page_type: string;
  recent_visitors: number;
  recent_signups: number;
  recent_conv_rate_pct: number;
  baseline_visitors: number;
  baseline_signups: number;
  baseline_conv_rate_pct: number;
  conv_rate_change_pct: number;
  pct_change: number;
  recent_traffic_share_pct: number;
}

export function LandingPageTable({
  weeksRecent,
  weeksBaseline,
}: LandingPageTableProps) {
  const sqlQuery = getLandingPageQuery(weeksRecent, weeksBaseline);
  const { data, isLoading, error } = useMetricsQuery(
    ["landing-page", String(weeksRecent), String(weeksBaseline)],
    sqlQuery,
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Landing Page Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">
            Error loading landing page data: {data?.error || String(error)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Landing Page Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows as unknown as LandingRow[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Landing Page Performance</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Conversion rate by landing page type with traffic share analysis
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Landing Page Type</TableHead>
              <TableHead className="text-right">Traffic Share</TableHead>
              <TableHead className="text-right">Recent Conv %</TableHead>
              <TableHead className="text-right">Baseline Conv %</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">% Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.landing_page_type}>
                <TableCell className="font-medium">
                  {row.landing_page_type}
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-semibold">
                    {(row.recent_traffic_share_pct ?? 0).toFixed(1)}%
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({(row.recent_visitors ?? 0).toLocaleString()})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-semibold">
                    {(row.recent_conv_rate_pct ?? 0).toFixed(2)}%
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({row.recent_signups ?? 0})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-semibold">
                    {(row.baseline_conv_rate_pct ?? 0).toFixed(2)}%
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({row.baseline_signups ?? 0})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      (row.conv_rate_change_pct ?? 0) < 0
                        ? "text-destructive"
                        : "text-green-600"
                    }
                  >
                    {(row.conv_rate_change_pct ?? 0) > 0 ? "+" : ""}
                    {(row.conv_rate_change_pct ?? 0).toFixed(2)}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div
                    className={`flex items-center justify-end gap-1 ${(row.pct_change ?? 0) < 0 ? "text-destructive" : "text-green-600"}`}
                  >
                    {(row.pct_change ?? 0) < 0 ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    )}
                    {(row.pct_change ?? 0) > 0 ? "+" : ""}
                    {(row.pct_change ?? 0).toFixed(1)}%
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
          <p>
            <strong>Interpretation:</strong> Check if high-converting pages
            (pricing, homepage) have declined in traffic share or conversion
            rate. Increasing blog traffic with low conversion suggests audience
            mismatch.
          </p>
        </div>

        <SqlCodeToggle sql={sqlQuery} title="View SQL Query" />
      </CardContent>
    </Card>
  );
}
