import { useMetricsQuery } from "@/lib/query-metrics";
import { getOverallTrendQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SqlCodeToggle } from "./SqlCodeToggle";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";

interface OverallTrendChartProps {
  months: number;
}

interface TrendRow {
  week: string;
  unique_visitors: number;
  total_signups: number;
  conversion_rate_pct: number;
  wow_change_pct: number | null;
}

export function OverallTrendChart({ months }: OverallTrendChartProps) {
  const sqlQuery = getOverallTrendQuery(months);
  const { data, isLoading, error } = useMetricsQuery(
    ["conversion-trend", String(months)],
    sqlQuery
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overall Conversion Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">Error loading trend data: {data?.error || String(error)}</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overall Conversion Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = (data.rows as unknown as TrendRow[]).reverse(); // Oldest to newest for chart
  const recentWeeks = rows.slice(-4);
  const baselineWeeks = rows.slice(-8, -4);
  
  const recentAvg = recentWeeks.reduce((sum, r) => sum + r.conversion_rate_pct, 0) / recentWeeks.length;
  const baselineAvg = baselineWeeks.reduce((sum, r) => sum + r.conversion_rate_pct, 0) / baselineWeeks.length;
  const changeVsBaseline = recentAvg - baselineAvg;
  const pctChangeVsBaseline = (changeVsBaseline / baselineAvg) * 100;

  const formatDate = (value: string) => {
    try {
      const d = new Date(value);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return String(value);
    }
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Overall Conversion Trend</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Weekly conversion rate over the last {months} months with week-over-week changes
        </p>
      </CardHeader>
      <CardContent>
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent 4 Weeks Avg</div>
            <div className="text-3xl font-bold mt-2">{recentAvg.toFixed(2)}%</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Baseline 4 Weeks Avg</div>
            <div className="text-3xl font-bold mt-2">{baselineAvg.toFixed(2)}%</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Change vs Baseline</div>
            <div className={`text-3xl font-bold mt-2 flex items-center gap-2 ${changeVsBaseline < 0 ? 'text-destructive' : 'text-green-600'}`}>
              {changeVsBaseline < 0 ? (
                <TrendingDown className="h-6 w-6" />
              ) : (
                <TrendingUp className="h-6 w-6" />
              )}
              <span>{changeVsBaseline > 0 ? '+' : ''}{changeVsBaseline.toFixed(2)}%</span>
              <span className="text-base text-muted-foreground font-normal">({pctChangeVsBaseline > 0 ? '+' : ''}{pctChangeVsBaseline.toFixed(1)}%)</span>
            </div>
          </div>
        </div>

        {/* Chart */}
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="week"
              tickFormatter={formatDate}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              stroke="hsl(var(--border))"
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              stroke="hsl(var(--border))"
              label={{ value: 'Unique Visitors', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: 'hsl(var(--muted-foreground))' } }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={formatPercent}
              tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              stroke="hsl(var(--border))"
              label={{ value: 'Conversion Rate %', angle: 90, position: 'insideRight', style: { fontSize: 12, fill: 'hsl(var(--muted-foreground))' } }}
            />
            <Tooltip
              labelFormatter={formatDate}
              formatter={(value: number, name: string) => {
                if (name === 'Conversion Rate') return `${value.toFixed(2)}%`;
                return value.toLocaleString();
              }}
              contentStyle={{
                backgroundColor: 'hsl(var(--background))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '12px'
              }}
              labelStyle={{
                color: 'hsl(var(--foreground))',
                fontWeight: 600,
                marginBottom: '4px'
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="left" dataKey="unique_visitors" fill="hsl(var(--primary))" opacity={0.5} name="Unique Visitors" />
            <Line yAxisId="right" type="monotone" dataKey="conversion_rate_pct" stroke="#3b82f6" strokeWidth={2.5} name="Conversion Rate" dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* WoW Change Indicator */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">Week-over-Week Changes (Last 8 Weeks)</div>
          <div className="flex flex-wrap gap-2">
            {rows.slice(-8).map((row, idx) => (
              row.wow_change_pct !== null && (
                <div 
                  key={row.week}
                  className={`px-2 py-1 rounded text-xs ${
                    row.wow_change_pct < 0 
                      ? 'bg-destructive/10 text-destructive' 
                      : row.wow_change_pct > 0
                      ? 'bg-green-100 text-green-700'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {formatDate(row.week)}: {row.wow_change_pct > 0 ? '+' : ''}{row.wow_change_pct.toFixed(2)}%
                </div>
              )
            ))}
          </div>
        </div>

        <SqlCodeToggle sql={sqlQuery} title="View SQL Query" />
      </CardContent>
    </Card>
  );
}
