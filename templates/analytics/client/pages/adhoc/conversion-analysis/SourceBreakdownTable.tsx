import { useMetricsQuery } from "@/lib/query-metrics";
import { getSourceBreakdownQuery } from "./queries";
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

interface SourceBreakdownTableProps {
  weeksRecent: number;
  weeksBaseline: number;
}

interface SourceRow {
  channel: string;
  recent_visitors: number;
  recent_signups: number;
  recent_conv_rate_pct: number;
  baseline_visitors: number;
  baseline_signups: number;
  baseline_conv_rate_pct: number;
  conv_rate_change_pct: number;
  pct_change: number;
}

export function SourceBreakdownTable({ weeksRecent, weeksBaseline }: SourceBreakdownTableProps) {
  const sqlQuery = getSourceBreakdownQuery(weeksRecent, weeksBaseline);
  const { data, isLoading, error } = useMetricsQuery(
    ["source-breakdown", String(weeksRecent), String(weeksBaseline)],
    sqlQuery
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Traffic Source Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">Error loading source data: {data?.error || String(error)}</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Traffic Source Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows as unknown as SourceRow[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Traffic Source Breakdown</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Conversion rate by channel with recent vs baseline comparison
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead className="text-right">Recent Visitors</TableHead>
              <TableHead className="text-right">Recent Conv %</TableHead>
              <TableHead className="text-right">Baseline Conv %</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">% Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.channel}>
                <TableCell className="font-medium">{row.channel}</TableCell>
                <TableCell className="text-right">{row.recent_visitors.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <span className="font-semibold">{row.recent_conv_rate_pct.toFixed(2)}%</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({row.recent_signups})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-semibold">{row.baseline_conv_rate_pct.toFixed(2)}%</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({row.baseline_signups})
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className={row.conv_rate_change_pct < 0 ? 'text-destructive' : 'text-green-600'}>
                    {row.conv_rate_change_pct > 0 ? '+' : ''}{row.conv_rate_change_pct.toFixed(2)}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className={`flex items-center justify-end gap-1 ${row.pct_change < 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {row.pct_change < 0 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                    {row.pct_change > 0 ? '+' : ''}{row.pct_change.toFixed(1)}%
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
          <p><strong>Interpretation:</strong> Focus on channels with high visitor volume and negative conversion rate changes. These are driving the overall decline.</p>
        </div>

        <SqlCodeToggle sql={sqlQuery} title="View SQL Query" />
      </CardContent>
    </Card>
  );
}
