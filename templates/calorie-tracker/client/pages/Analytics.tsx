import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { AppHeader } from "@/components/AppHeader";
import { WeeklyCaloriesChart } from "@/components/WeeklyCaloriesChart";
import { ChevronLeft, Calendar } from "lucide-react";
import { formatLocalDate } from "@/lib/utils";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DailyCalories {
  date: string;
  totalCalories: number;
  burnedCalories: number;
  netCalories: number;
  displayDate: string;
}

interface WeightHistoryEntry {
  date: string;
  weight: number;
  trendWeight: number;
  displayDate: string;
}

const GOAL_CALORIES = 2000;

export default function Analytics() {
  const [timeRange, setTimeRange] = useState("30");

  const getStartDate = (range: string) => {
    if (range === "all") return "2000-01-01";
    return formatLocalDate(subDays(new Date(), parseInt(range)));
  };

  const { data: history, isLoading } = useQuery<DailyCalories[]>({
    queryKey: ["/api/meals/history", timeRange],
    queryFn: async () => {
      const endDate = formatLocalDate(new Date());
      const startDate = getStartDate(timeRange);
      return await apiRequest(
        "GET",
        `/api/meals/history?startDate=${startDate}&endDate=${endDate}`,
      );
    },
  });

  const { data: weightHistory, isLoading: weightLoading } = useQuery<
    WeightHistoryEntry[]
  >({
    queryKey: ["/api/weights/history", timeRange],
    queryFn: async () => {
      const endDate = formatLocalDate(new Date());
      const startDate = getStartDate(timeRange);
      return await apiRequest(
        "GET",
        `/api/weights/history?startDate=${startDate}&endDate=${endDate}`,
      );
    },
  });

  // Calculate weight stats
  const weightStats = weightHistory
    ? {
        current:
          weightHistory.length > 0
            ? weightHistory[weightHistory.length - 1].weight
            : 0,
        change:
          weightHistory.length >= 2
            ? Math.round(
                (weightHistory[weightHistory.length - 1].trendWeight -
                  weightHistory[0].trendWeight) *
                  10,
              ) / 10
            : 0,
        lowest:
          weightHistory.length > 0
            ? Math.min(...weightHistory.map((w) => w.weight))
            : 0,
        highest:
          weightHistory.length > 0
            ? Math.max(...weightHistory.map((w) => w.weight))
            : 0,
      }
    : { current: 0, change: 0, lowest: 0, highest: 0 };

  // Get Y-axis domain for weight chart
  const getWeightYDomain = () => {
    if (!weightHistory || weightHistory.length === 0) return [0, 200];
    const weights = weightHistory.map((h) => h.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const padding = (max - min) * 0.3 || 5;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  };

  const stats = history
    ? {
        average:
          Math.round(
            history.reduce((sum, day) => sum + day.netCalories, 0) /
              history.length,
          ) || 0,
        highest: Math.max(...history.map((day) => day.netCalories), 0),
        lowest: Math.min(...history.map((day) => day.netCalories), 0),
        total: history.length,
      }
    : { average: 0, highest: 0, lowest: 0, total: 0 };

  return (
    <div className="min-h-screen pb-20 relative z-10">
      <AppHeader />

      <main className="max-w-2xl lg:max-w-4xl mx-auto px-4 py-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[140px] bg-card/40 border-border/30 h-9 text-xs">
              <Calendar className="w-3.5 h-3.5 mr-2 opacity-50" />
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-white/10">
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="p-4 rounded-xl bg-card/40 border border-border/30">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">
              Average
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-foreground">
                {stats.average}
              </span>
              <span className="text-xs text-muted-foreground">kcal</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-card/40 border border-border/30">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">
              Lowest
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-foreground">
                {stats.lowest}
              </span>
              <span className="text-xs text-muted-foreground">kcal</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-card/40 border border-border/30">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">
              Highest
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-foreground">
                {stats.highest}
              </span>
              <span className="text-xs text-muted-foreground">kcal</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-card/40 border border-border/30">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">
              Days Tracked
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-foreground">
                {stats.total}
              </span>
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </div>
        </div>

        {/* Charts with Tabs */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-md overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">
              Calorie Trend ({timeRange === "all" ? "All Time" : `Last ${timeRange} Days`})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="net" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-6 bg-secondary/40">
                <TabsTrigger value="net">Net</TabsTrigger>
                <TabsTrigger value="consumed">Consumed</TabsTrigger>
                <TabsTrigger value="burned">Burned</TabsTrigger>
              </TabsList>

              <TabsContent value="net" className="mt-0">
                {isLoading ? (
                  <Skeleton className="h-[300px] w-full rounded-xl" />
                ) : history && history.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={history}
                      margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="displayDate"
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                        }}
                        itemStyle={{ fontSize: "12px" }}
                        labelStyle={{
                          fontSize: "12px",
                          color: "hsl(var(--muted-foreground))",
                          marginBottom: "4px",
                        }}
                        formatter={(value) => [`${value} kcal`, "Net Calories"]}
                      />
                      <ReferenceLine
                        y={GOAL_CALORIES}
                        stroke="hsl(var(--foreground))"
                        strokeDasharray="3 3"
                        strokeOpacity={0.3}
                      />
                      <Line
                        type="monotone"
                        dataKey="netCalories"
                        stroke="hsl(var(--foreground))"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 4,
                          strokeWidth: 0,
                          fill: "hsl(var(--foreground))",
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
                    <p className="text-sm">No data available yet</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="consumed" className="mt-0">
                {isLoading ? (
                  <Skeleton className="h-[300px] w-full rounded-xl" />
                ) : history && history.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={history}
                      margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="displayDate"
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                        }}
                        itemStyle={{ fontSize: "12px" }}
                        labelStyle={{
                          fontSize: "12px",
                          color: "hsl(var(--muted-foreground))",
                          marginBottom: "4px",
                        }}
                        formatter={(value) => [`${value} kcal`, "Consumed"]}
                      />
                      <ReferenceLine
                        y={GOAL_CALORIES}
                        stroke="hsl(var(--foreground))"
                        strokeDasharray="3 3"
                        strokeOpacity={0.3}
                      />
                      <Line
                        type="monotone"
                        dataKey="totalCalories"
                        stroke="hsl(var(--foreground))"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 4,
                          strokeWidth: 0,
                          fill: "hsl(var(--foreground))",
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
                    <p className="text-sm">No data available yet</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="burned" className="mt-0">
                {isLoading ? (
                  <Skeleton className="h-[300px] w-full rounded-xl" />
                ) : history && history.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={history}
                      margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="displayDate"
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                        }}
                        itemStyle={{ fontSize: "12px" }}
                        labelStyle={{
                          fontSize: "12px",
                          color: "hsl(var(--muted-foreground))",
                          marginBottom: "4px",
                        }}
                        formatter={(value) => [`${value} kcal`, "Burned"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="burnedCalories"
                        stroke="#ea580c"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0, fill: "#ea580c" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
                    <p className="text-sm">No data available yet</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        {/* Weekly Net Calories vs Goal */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-md overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">
              Weekly Net Calories vs Goal ({timeRange === "all" ? "All Time" : `Last ${timeRange} Days`})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <WeeklyCaloriesChart
              history={history}
              isLoading={isLoading}
              dailyGoal={GOAL_CALORIES}
            />
          </CardContent>
        </Card>

        {/* Weight Chart */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-md overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">
              Weight Trend ({timeRange === "all" ? "All Time" : `Last ${timeRange} Days`})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Weight Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="p-3 rounded-lg bg-secondary/30">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
                  Current
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-foreground">
                    {weightStats.current}
                  </span>
                  <span className="text-xs text-muted-foreground">lbs</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
                  Change
                </p>
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-lg font-bold ${weightStats.change < 0 ? "text-green-500" : weightStats.change > 0 ? "text-orange-500" : "text-foreground"}`}
                  >
                    {weightStats.change > 0 ? "+" : ""}
                    {weightStats.change}
                  </span>
                  <span className="text-xs text-muted-foreground">lbs</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
                  Lowest
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-foreground">
                    {weightStats.lowest}
                  </span>
                  <span className="text-xs text-muted-foreground">lbs</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-secondary/30">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
                  Highest
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-foreground">
                    {weightStats.highest}
                  </span>
                  <span className="text-xs text-muted-foreground">lbs</span>
                </div>
              </div>
            </div>

            <Tabs defaultValue="trend" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6 bg-secondary/40">
                <TabsTrigger value="trend">Trend View</TabsTrigger>
                <TabsTrigger value="actual">Actual Weight</TabsTrigger>
              </TabsList>

              <TabsContent value="trend" className="mt-0">
                {weightLoading ? (
                  <Skeleton className="h-[300px] w-full rounded-xl" />
                ) : weightHistory && weightHistory.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      The blue trend line smooths out daily fluctuations to show
                      your overall progress.
                    </p>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart
                        data={weightHistory}
                        margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="displayDate"
                          stroke="hsl(var(--muted-foreground))"
                          style={{ fontSize: "10px" }}
                          tickLine={false}
                          axisLine={false}
                          dy={10}
                        />
                        <YAxis
                          domain={getWeightYDomain()}
                          stroke="hsl(var(--muted-foreground))"
                          style={{ fontSize: "10px" }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "12px",
                            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                          }}
                          itemStyle={{ fontSize: "12px" }}
                          labelStyle={{
                            fontSize: "12px",
                            color: "hsl(var(--muted-foreground))",
                            marginBottom: "4px",
                          }}
                          formatter={(value: number, name: string) => [
                            `${value} lbs`,
                            name === "trendWeight" ? "Trend" : "Actual",
                          ]}
                        />
                        {/* Actual weight points */}
                        <Line
                          type="monotone"
                          dataKey="weight"
                          stroke="hsl(var(--muted-foreground))"
                          strokeWidth={0}
                          dot={{ fill: "hsl(var(--foreground))", r: 3 }}
                          activeDot={{ r: 5, strokeWidth: 0 }}
                        />
                        {/* Smoothed trend line */}
                        <Line
                          type="monotone"
                          dataKey="trendWeight"
                          stroke="#3b82f6"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 5, strokeWidth: 0, fill: "#3b82f6" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
                    <p className="text-sm">No weight data available yet</p>
                    <p className="text-xs mt-1">
                      Start logging your weight to see trends
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="actual" className="mt-0">
                {weightLoading ? (
                  <Skeleton className="h-[300px] w-full rounded-xl" />
                ) : weightHistory && weightHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={weightHistory}
                      margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="displayDate"
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                      />
                      <YAxis
                        domain={getWeightYDomain()}
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: "10px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                        }}
                        itemStyle={{ fontSize: "12px" }}
                        labelStyle={{
                          fontSize: "12px",
                          color: "hsl(var(--muted-foreground))",
                          marginBottom: "4px",
                        }}
                        formatter={(value: number) => [
                          `${value} lbs`,
                          "Weight",
                        ]}
                      />
                      <Line
                        type="linear"
                        dataKey="weight"
                        stroke="hsl(var(--foreground))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--foreground))", r: 3 }}
                        activeDot={{
                          r: 5,
                          strokeWidth: 0,
                          fill: "hsl(var(--foreground))",
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
                    <p className="text-sm">No weight data available yet</p>
                    <p className="text-xs mt-1">
                      Start logging your weight to see trends
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
