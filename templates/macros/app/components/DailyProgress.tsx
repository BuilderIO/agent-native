import { useState, useEffect } from "react";
import { cn, formatLocalDate } from "@/lib/utils";
import { useActionQuery } from "@agent-native/core/client";
import { subDays } from "date-fns";
import { Link } from "react-router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconTrendingUp,
  IconActivity,
  IconChartBar,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface DailyProgressProps {
  totalCalories: number;
  totalBurnedCalories: number;
  goalCalories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function DailyProgress({
  totalCalories,
  totalBurnedCalories,
  goalCalories,
  protein,
  carbs,
  fat,
}: DailyProgressProps) {
  const [activeChart, setActiveChart] = useState(
    () =>
      (typeof window !== "undefined"
        ? localStorage.getItem("hero_active_chart")
        : null) || "weight",
  );

  useEffect(() => {
    localStorage.setItem("hero_active_chart", activeChart);
  }, [activeChart]);

  const netCalories = totalCalories - totalBurnedCalories;
  const percentage = Math.min(100, (netCalories / goalCalories) * 100);
  const remaining = Math.max(0, goalCalories - netCalories);
  const isOver = netCalories > goalCalories;

  const endDate = formatLocalDate(new Date());
  const startDate = formatLocalDate(subDays(new Date(), 30));

  const { data: rawWeightHistory, isLoading: weightLoading } = useActionQuery(
    "weights-history",
    { startDate, endDate },
    { enabled: activeChart === "weight" },
  );
  const weightHistory = Array.isArray(rawWeightHistory) ? rawWeightHistory : [];

  const { data: rawCalorieHistory, isLoading: calorieLoading } = useActionQuery(
    "meals-history",
    { startDate, endDate },
    { enabled: activeChart === "activity" },
  );
  const calorieHistory = Array.isArray(rawCalorieHistory)
    ? rawCalorieHistory
    : [];

  const getYDomain = (data: any[], key: string) => {
    if (!data || data.length === 0) return [0, 100];
    const values = data.map((h) => h[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.2 || 10;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5 backdrop-blur-sm">
      <div className="grid xl:grid-cols-[1fr_340px] gap-6 xl:gap-8">
        {/* Left Side */}
        <div className="space-y-8 flex flex-col justify-center">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Daily Summary
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.05] flex items-center">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest leading-none">
                Goal: {goalCalories}
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline gap-2 sm:gap-3">
              <span
                className={cn(
                  "text-5xl sm:text-7xl font-bold tracking-tighter text-foreground",
                  isOver && "text-red-400",
                )}
              >
                {netCalories}
              </span>
              <span className="text-base sm:text-xl font-medium text-muted-foreground uppercase tracking-widest">
                kcal
              </span>
            </div>
          </div>

          <div className="space-y-3 mt-auto">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400/60" />
                <span className="text-sm text-muted-foreground">
                  <span className="font-semibold text-emerald-400">
                    {totalCalories}
                  </span>{" "}
                  eaten
                </span>
              </div>
              {totalBurnedCalories > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-400/60" />
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold text-orange-400">
                      {totalBurnedCalories}
                    </span>{" "}
                    burned
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-muted-foreground">
                  <span
                    className={cn(
                      "font-semibold",
                      isOver ? "text-red-400" : "text-foreground",
                    )}
                  >
                    {remaining}
                  </span>{" "}
                  remaining
                </span>
              </div>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500 ease-out rounded-full",
                  isOver ? "bg-red-400" : "bg-foreground",
                )}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
          </div>

          {(protein > 0 || carbs > 0 || fat > 0) && (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: "Protein", value: protein },
                { label: "Carbs", value: carbs },
                { label: "Fat", value: fat },
              ].map((m) => (
                <div
                  key={m.label}
                  className="p-2.5 sm:p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]"
                >
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {m.label}
                  </p>
                  <p className="text-base sm:text-lg font-bold text-foreground">
                    {m.value}g
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side: Charts */}
        <div className="hidden xl:flex border-l border-white/[0.08] pl-8 flex-col justify-center transition-all duration-300">
          <Tabs
            value={activeChart}
            onValueChange={setActiveChart}
            className="flex flex-col space-y-6"
          >
            <div className="flex items-center justify-between">
              <TabsList className="bg-white/[0.04] border border-white/[0.08] h-8">
                <TabsTrigger
                  value="weight"
                  className="gap-2 text-[10px] uppercase tracking-wider h-6 px-3"
                >
                  <IconTrendingUp className="h-3 w-3" /> Weight
                </TabsTrigger>
                <TabsTrigger
                  value="activity"
                  className="gap-2 text-[10px] uppercase tracking-wider h-6 px-3"
                >
                  <IconActivity className="h-3 w-3" /> Activity
                </TabsTrigger>
              </TabsList>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link to="/analytics">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5 text-[10px] uppercase tracking-widest text-muted-foreground/50 hover:text-foreground hover:bg-white/5 gap-2"
                      >
                        Last 30D <IconChartBar className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="bg-zinc-900 border-white/10 text-[10px] uppercase tracking-widest py-1.5 px-3"
                  >
                    View Full Analytics
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <TabsContent
              value="weight"
              className="mt-0 flex-1 flex flex-col justify-center animate-in fade-in duration-500"
            >
              <div className="h-[140px] w-full">
                {weightLoading ? (
                  <Skeleton className="h-full w-full rounded-xl bg-white/[0.02]" />
                ) : weightHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={weightHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <XAxis dataKey="displayDate" hide />
                      <YAxis
                        domain={getYDomain(weightHistory, "weight")}
                        hide
                      />
                      <ChartTooltip
                        contentStyle={{
                          backgroundColor: "#09090b",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "8px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                          fontSize: "12px",
                          color: "#fff",
                        }}
                        cursor={{ stroke: "rgba(255,255,255,0.1)" }}
                        formatter={(value: number, name: string) => [
                          `${value} lbs`,
                          name === "trendWeight" ? "Trend" : "Actual",
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="weight"
                        stroke="rgba(255,255,255,0.2)"
                        strokeWidth={1}
                        dot={{
                          fill: "rgba(255,255,255,0.2)",
                          r: 2,
                        }}
                        activeDot={{
                          r: 4,
                          strokeWidth: 0,
                          fill: "#fff",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="trendWeight"
                        stroke="#fff"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 4,
                          strokeWidth: 0,
                          fill: "#fff",
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center border border-dashed border-white/[0.06] rounded-xl">
                    <p className="text-xs text-muted-foreground">
                      No weight data available
                    </p>
                  </div>
                )}
              </div>
              {weightHistory.length > 0 && (
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 text-right mt-2">
                  Current: {weightHistory[weightHistory.length - 1].weight} lbs
                </p>
              )}
            </TabsContent>

            <TabsContent
              value="activity"
              className="mt-0 flex-1 flex flex-col justify-center animate-in fade-in duration-500"
            >
              <div className="h-[140px] w-full">
                {calorieLoading ? (
                  <Skeleton className="h-full w-full rounded-xl bg-white/[0.02]" />
                ) : calorieHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={calorieHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorNet"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#fff"
                            stopOpacity={0.1}
                          />
                          <stop offset="95%" stopColor="#fff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="displayDate" hide />
                      <YAxis
                        domain={getYDomain(calorieHistory, "netCalories")}
                        hide
                      />
                      <ChartTooltip
                        contentStyle={{
                          backgroundColor: "#09090b",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "8px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                          fontSize: "12px",
                          color: "#fff",
                        }}
                        cursor={{ stroke: "rgba(255,255,255,0.1)" }}
                        formatter={(value: number) => [
                          `${value} kcal`,
                          "Net Calories",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="netCalories"
                        stroke="#fff"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorNet)"
                        activeDot={{
                          r: 4,
                          strokeWidth: 0,
                          fill: "#fff",
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center border border-dashed border-white/[0.06] rounded-xl">
                    <p className="text-xs text-muted-foreground">
                      No activity data available
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
