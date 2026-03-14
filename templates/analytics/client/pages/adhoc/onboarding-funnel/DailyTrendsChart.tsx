import { useMetricsQuery } from "@/lib/query-metrics";
import { getDailyFunnelQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DailyTrendsChartProps {
  dateStart: string;
  dateEnd: string;
}

interface DailyMetrics {
  event_date: string;
  signups: number;
  onboarding_shown: number;
  completed: number;
  pct_shown: number;
  pct_completed: number;
}

export function DailyTrendsChart({ dateStart, dateEnd }: DailyTrendsChartProps) {
  const { data, isLoading, error } = useMetricsQuery(
    ["daily-trends", dateStart, dateEnd],
    getDailyFunnelQuery(dateStart, dateEnd)
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">Error loading data: {data?.error || String(error)}</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[350px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows as unknown as DailyMetrics[];
  // Reverse to show oldest to newest
  const chartData = [...rows].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily Onboarding Trends</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Daily signup volume and completion rates over time
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="event_date"
              tick={{ fontSize: 11 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              label={{ value: 'Users', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              label={{ value: 'Completion %', angle: 90, position: 'insideRight', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: any, name: string) => {
                if (name === 'signups') return [value.toLocaleString(), 'Signups'];
                if (name === 'completed') return [value.toLocaleString(), 'Completed'];
                if (name === 'pct_completed') return [value + '%', 'Completion Rate'];
                return [value, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="signups"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3 }}
              name="Signups"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="completed"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 3 }}
              name="Completed"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="pct_completed"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 3 }}
              name="Completion %"
              strokeDasharray="5 5"
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Summary Stats */}
        <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Total Signups</div>
            <div className="text-lg font-bold">
              {rows.reduce((sum, d) => sum + d.signups, 0).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Total Completed</div>
            <div className="text-lg font-bold text-green-600">
              {rows.reduce((sum, d) => sum + d.completed, 0).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Avg Daily Signups</div>
            <div className="text-lg font-bold">
              {(rows.reduce((sum, d) => sum + d.signups, 0) / rows.length).toFixed(0)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Avg Completion Rate</div>
            <div className="text-lg font-bold text-blue-600">
              {(rows.reduce((sum, d) => sum + (d.pct_completed || 0), 0) / rows.filter(d => d.pct_completed).length).toFixed(1)}%
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
