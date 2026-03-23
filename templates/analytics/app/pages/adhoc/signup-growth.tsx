import { useState, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { cn } from "@/lib/utils";

type Granularity = "daily" | "weekly";

function signupsSql(granularity: Granularity) {
  const trunc = granularity === "weekly" ? "WEEK(MONDAY)" : "DAY";
  return `SELECT
  TIMESTAMP_TRUNC(user_create_d, ${trunc}) AS day,
  COUNT(DISTINCT user_id) AS signups
FROM \`your-gcp-project-id.dbt_analytics.product_signups\`
WHERE user_create_d >= TIMESTAMP("2026-01-01")
  AND user_create_d <= CURRENT_TIMESTAMP()
GROUP BY day ORDER BY day ASC`;
}

// 2x YoY goal: start at baseline (avg of first 2 weeks of Jan),
// linearly grow to 2x that rate by Dec 31, 2026.
function buildGoalLine(
  actualData: Record<string, unknown>[],
  granularity: Granularity,
) {
  if (actualData.length < 3) return [];

  // Compute baseline from first 14 days (or 2 weeks) of data
  const baselineWindow = granularity === "weekly" ? 2 : 14;
  const baselineSlice = actualData.slice(
    0,
    Math.min(baselineWindow, actualData.length),
  );
  const baselineRate =
    baselineSlice.reduce((sum, r) => sum + Number(r.signups || 0), 0) /
    baselineSlice.length;

  const goalRate = baselineRate * 2;
  const yearStart = new Date("2026-01-01T00:00:00Z").getTime();
  const yearEnd = new Date("2026-12-31T00:00:00Z").getTime();
  const yearSpan = yearEnd - yearStart;

  return actualData.map((row) => {
    const ts = new Date(row.day as string).getTime();
    const progress = Math.min(Math.max((ts - yearStart) / yearSpan, 0), 1);
    return {
      day: row.day as string,
      goal: Math.round(baselineRate + (goalRate - baselineRate) * progress),
    };
  });
}

function mergeData(
  actual: Record<string, unknown>[],
  goal: { day: string; goal: number }[],
) {
  const goalMap = new Map(goal.map((g) => [g.day, g.goal]));
  return actual.map((row) => ({
    day: row.day as string,
    signups: Number(row.signups || 0),
    goal: goalMap.get(row.day as string) ?? null,
  }));
}

const formatDate = (value: string) => {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
};

export default function SignupGrowthDashboard() {
  const [granularity, setGranularity] = useState<Granularity>("daily");

  const signups = useMetricsQuery(
    ["signup-growth", granularity],
    signupsSql(granularity),
  );

  const chartData = useMemo(() => {
    const rows = signups.data?.rows ?? [];
    if (rows.length === 0) return [];
    const goal = buildGoalLine(rows, granularity);
    return mergeData(rows, goal);
  }, [signups.data, granularity]);

  const baseline = useMemo(() => {
    if (chartData.length < 3) return null;
    const window = granularity === "weekly" ? 2 : 14;
    const slice = chartData.slice(0, Math.min(window, chartData.length));
    const avg = slice.reduce((s, r) => s + r.signups, 0) / slice.length;
    return Math.round(avg);
  }, [chartData, granularity]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {(["daily", "weekly"] as const).map((g) => (
            <Button
              key={g}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-3 text-xs capitalize",
                granularity === g && "bg-secondary text-secondary-foreground",
              )}
              onClick={() => setGranularity(g)}
            >
              {g}
            </Button>
          ))}
        </div>
        {baseline !== null && (
          <span className="text-xs text-muted-foreground">
            Jan baseline: ~{baseline.toLocaleString()}/
            {granularity === "weekly" ? "wk" : "day"} — Goal: ~
            {(baseline * 2).toLocaleString()}/
            {granularity === "weekly" ? "wk" : "day"} by Dec 31, 2026
          </span>
        )}
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Signups vs 2x YoY Goal</CardTitle>
        </CardHeader>
        <CardContent>
          {signups.isLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : signups.data?.error ? (
            <p className="text-sm text-red-400 py-8 text-center">
              {signups.data.error}
            </p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No data available
            </p>
          ) : (
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <defs>
                    <linearGradient
                      id="signups-gradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    stroke="#52525b"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDate}
                  />
                  <YAxis
                    stroke="#52525b"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#27272a"
                    vertical={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#09090b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      color: "#fafafa",
                    }}
                    labelFormatter={formatDate}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="signups"
                    name="Actual Signups"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#signups-gradient)"
                  />
                  <Line
                    type="monotone"
                    dataKey="goal"
                    name="2x YoY Goal"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
