import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  startOfWeek,
  endOfWeek,
  format,
  parseISO,
  isToday,
  isBefore,
  startOfDay,
} from "date-fns";
import type { DailyCalories } from "@shared/types";

interface WeeklyData {
  weekLabel: string;
  weekStart: string;
  netCalories: number;
  totalCalories: number;
  burnedCalories: number;
  daysTracked: number;
  weeklyGoal: number;
  projectedCalories: number;
  isCurrentWeek: boolean;
  completedDays: number;
}

interface WeeklyCaloriesChartProps {
  history: DailyCalories[] | undefined;
  isLoading: boolean;
  dailyGoal?: number;
}

function aggregateWeekly(
  history: DailyCalories[],
  dailyGoal: number,
): WeeklyData[] {
  const now = new Date();
  const currentWeekStart = format(
    startOfWeek(now, { weekStartsOn: 1 }),
    "yyyy-MM-dd",
  );
  const todayStart = startOfDay(now);
  const weekMap = new Map<
    string,
    {
      netCalories: number;
      totalCalories: number;
      burnedCalories: number;
      daysTracked: number;
      completedDayCalories: number;
      completedDays: number;
      weekStart: Date;
      weekEnd: Date;
    }
  >();

  for (const day of history) {
    const date = parseISO(day.date);
    const ws = startOfWeek(date, { weekStartsOn: 1 });
    const we = endOfWeek(date, { weekStartsOn: 1 });
    const key = format(ws, "yyyy-MM-dd");
    const existing = weekMap.get(key) || {
      netCalories: 0,
      totalCalories: 0,
      burnedCalories: 0,
      daysTracked: 0,
      completedDayCalories: 0,
      completedDays: 0,
      weekStart: ws,
      weekEnd: we,
    };
    existing.netCalories += day.netCalories;
    existing.totalCalories += day.totalCalories;
    existing.burnedCalories += day.burnedCalories;
    existing.daysTracked += 1;
    const isCompletedDay = isBefore(date, todayStart) && !isToday(date);
    if (isCompletedDay) {
      existing.completedDayCalories += day.netCalories;
      existing.completedDays += 1;
    }
    weekMap.set(key, existing);
  }

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, week]) => {
      const isCurrentWeek = key === currentWeekStart;
      let projectedCalories = 0;
      if (isCurrentWeek && week.completedDays > 0) {
        const avgPerDay = week.completedDayCalories / week.completedDays;
        projectedCalories = Math.round(avgPerDay * (7 - week.daysTracked));
      }
      return {
        weekLabel: `${format(week.weekStart, "MMM d")} - ${format(week.weekEnd, "MMM d")}`,
        weekStart: key,
        netCalories: week.netCalories,
        totalCalories: week.totalCalories,
        burnedCalories: week.burnedCalories,
        daysTracked: week.daysTracked,
        weeklyGoal: dailyGoal * 7,
        projectedCalories,
        isCurrentWeek,
        completedDays: week.completedDays,
      };
    });
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload as WeeklyData;
  const projected = data.netCalories + data.projectedCalories;
  const diff = data.netCalories - data.weeklyGoal;
  const isOver = diff > 0;
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-lg text-sm space-y-1.5">
      <p className="text-xs text-muted-foreground font-medium">
        {data.weekLabel}
      </p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-bold text-foreground">
          {data.netCalories.toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground">net kcal</span>
      </div>
      {data.isCurrentWeek && data.projectedCalories > 0 && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold text-muted-foreground">
            ~{projected.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">projected</span>
        </div>
      )}
      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>Eaten: {data.totalCalories.toLocaleString()} kcal</p>
        <p>Burned: {data.burnedCalories.toLocaleString()} kcal</p>
        <p>Goal: {data.weeklyGoal.toLocaleString()} kcal</p>
        <p className={isOver ? "text-red-400" : "text-emerald-400"}>
          {isOver ? "+" : ""}
          {diff.toLocaleString()} vs goal
        </p>
        <p className="text-muted-foreground/60">
          {data.daysTracked} day{data.daysTracked !== 1 ? "s" : ""} tracked
          {data.isCurrentWeek && ` · ${data.completedDays} completed`}
        </p>
      </div>
    </div>
  );
}

export function WeeklyCaloriesChart({
  history,
  isLoading,
  dailyGoal = 2000,
}: WeeklyCaloriesChartProps) {
  if (isLoading) return <Skeleton className="h-[300px] w-full rounded-xl" />;
  if (!history || history.length === 0)
    return (
      <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
        <p className="text-sm">No data available yet</p>
        <p className="text-xs mt-1">Start logging meals to see weekly trends</p>
      </div>
    );

  const weeklyData = aggregateWeekly(history, dailyGoal);
  const weeklyGoal = dailyGoal * 7;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          {
            label: "Avg / Week",
            value:
              weeklyData.length > 0
                ? Math.round(
                    weeklyData.reduce((s, w) => s + w.netCalories, 0) /
                      weeklyData.length,
                  ).toLocaleString()
                : "0",
            unit: "kcal",
          },
          {
            label: "Weekly Goal",
            value: weeklyGoal.toLocaleString(),
            unit: "kcal",
          },
          {
            label: "Weeks",
            value: String(weeklyData.length),
            unit: "tracked",
          },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-lg bg-secondary/30">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
              {s.label}
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold text-foreground">
                {s.value}
              </span>
              <span className="text-xs text-muted-foreground">{s.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={weeklyData}
          margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey="weekLabel"
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "10px" }}
            tickLine={false}
            axisLine={false}
            dy={10}
            interval="preserveStartEnd"
            angle={-25}
            textAnchor="end"
            height={50}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            style={{ fontSize: "10px" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <ReferenceLine
            y={weeklyGoal}
            stroke="hsl(var(--foreground))"
            strokeDasharray="4 4"
            strokeOpacity={0.4}
            label={{
              value: "Goal",
              position: "right",
              style: {
                fontSize: "10px",
                fill: "hsl(var(--muted-foreground))",
              },
            }}
          />
          <Bar
            dataKey="netCalories"
            stackId="weekly"
            maxBarSize={48}
            radius={
              weeklyData.some((e) => e.projectedCalories > 0)
                ? [0, 0, 0, 0]
                : [6, 6, 0, 0]
            }
          >
            {weeklyData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  entry.netCalories > weeklyGoal
                    ? "hsl(0, 80%, 60%)"
                    : "hsl(var(--foreground))"
                }
                fillOpacity={entry.netCalories > weeklyGoal ? 0.7 : 0.8}
              />
            ))}
          </Bar>
          <Bar
            dataKey="projectedCalories"
            stackId="weekly"
            radius={[6, 6, 0, 0]}
            maxBarSize={48}
          >
            {weeklyData.map((entry, index) => {
              const total = entry.netCalories + entry.projectedCalories;
              return (
                <Cell
                  key={`proj-${index}`}
                  fill={
                    total > weeklyGoal
                      ? "hsl(0, 80%, 60%)"
                      : "hsl(var(--foreground))"
                  }
                  fillOpacity={entry.projectedCalories > 0 ? 0.25 : 0}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
