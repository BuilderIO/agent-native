import { useMetricsQuery } from "@/lib/query-metrics";
import { getTimeToCompleteQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface TimeToCompleteChartProps {
  dateStart: string;
  dateEnd: string;
}

interface TimeBucket {
  time_bucket: string;
  user_count: number;
  avg_minutes: number;
}

const COLORS = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#991b1b",
];

export function TimeToCompleteChart({
  dateStart,
  dateEnd,
}: TimeToCompleteChartProps) {
  const { data, isLoading, error } = useMetricsQuery(
    ["time-to-complete", dateStart, dateEnd],
    getTimeToCompleteQuery(dateStart, dateEnd),
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Time to Complete Onboarding
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">
            Error loading data: {data?.error || String(error)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Time to Complete Onboarding
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows as unknown as TimeBucket[];
  const totalUsers = rows.reduce((sum, d) => sum + d.user_count, 0);
  const chartData = rows.map((d) => ({
    ...d,
    percentage: ((d.user_count / totalUsers) * 100).toFixed(1),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Time to Complete Onboarding</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Distribution of time from account signup to onboarding completion
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time_bucket"
              tick={{ fontSize: 12 }}
              angle={-15}
              textAnchor="end"
              height={60}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: any, name: string) => {
                if (name === "user_count")
                  return [value.toLocaleString(), "Users"];
                return [value, name];
              }}
            />
            <Bar dataKey="user_count" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Stats Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-semibold">Time Range</th>
                <th className="text-right py-2 font-semibold">Users</th>
                <th className="text-right py-2 font-semibold">Percentage</th>
                <th className="text-right py-2 font-semibold">Avg Minutes</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((row, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  <td className="py-2">{row.time_bucket}</td>
                  <td className="text-right py-2 font-medium">
                    {row.user_count.toLocaleString()}
                  </td>
                  <td className="text-right py-2 text-muted-foreground">
                    {row.percentage}%
                  </td>
                  <td className="text-right py-2 text-muted-foreground">
                    {row.avg_minutes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
          <strong>{totalUsers.toLocaleString()}</strong> users completed
          onboarding in this period
        </div>
      </CardContent>
    </Card>
  );
}
