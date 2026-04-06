import { useState, useEffect } from "react";
import { cn, formatLocalDate } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { subDays } from "date-fns";
import { Link } from "react-router-dom";
import { apiRequest } from "@/lib/queryClient";
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
  TrendingUp,
  Activity,
  LayoutDashboard,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface DailyProgressProps {
  totalCalories: number;
  totalBurnedCalories: number;
  goalCalories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface WeightHistoryEntry {
  date: string;
  weight: number;
  trendWeight: number;
  displayDate: string;
}

interface CalorieHistoryEntry {
  date: string;
  totalCalories: number;
  burnedCalories: number;
  netCalories: number;
  displayDate: string;
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
    () => localStorage.getItem("hero_active_chart") || "weight",
  );
  const [showTrendsMobile, setShowTrendsMobile] = useState(false);

  useEffect(() => {
    localStorage.setItem("hero_active_chart", activeChart);
  }, [activeChart]);

  const netCalories = totalCalories - totalBurnedCalories;
  const percentage = Math.min(100, (netCalories / goalCalories) * 100);
  const remaining = Math.max(0, goalCalories - netCalories);
  const isOver = netCalories > goalCalories;

  const { data: weightHistory, isLoading: weightLoading } = useQuery<
    WeightHistoryEntry[]
  >({
    queryKey: ["/api/weights/history"],
    queryFn: async () => {
      const endDate = formatLocalDate(new Date());
      const startDate = formatLocalDate(subDays(new Date(), 30));
      return await apiRequest(
        "GET",
        `/api/weights/history?startDate=${startDate}&endDate=${endDate}`,
      );
    },
    enabled: activeChart === "weight",
  });

  const { data: calorieHistory, isLoading: calorieLoading } = useQuery<
    CalorieHistoryEntry[]
  >({
    queryKey: ["/api/meals/history"],
    queryFn: async () => {
      const endDate = formatLocalDate(new Date());
      const startDate = formatLocalDate(subDays(new Date(), 30));
      return await apiRequest(
        "GET",
        `/api/meals/history?startDate=${startDate}&endDate=${endDate}`,
      );
    },
    enabled: activeChart === "activity",
  });

  const getYDomain = (data: any[], key: string) => {
    if (!data || data.length === 0) return [0, 100];
    const values = data.map((h) => h[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.2 || 10;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-sm">
      <div className="grid lg:grid-cols-[1fr,340px] gap-8">
        {/* Left Side: Calorie Summary */}
        <div className="space-y-8 flex flex-col justify-center">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Daily Summary
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden h-6 px-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-white/5 gap-1"
                onClick={() => setShowTrendsMobile(!showTrendsMobile)}
              >
                {showTrendsMobile ? (
                  <>
                    Hide Trends <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    Show Trends <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </Button>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.05] flex items-center">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest leading-none">
                Goal: {goalCalories}
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline gap-3">
              <span
                className={cn(
                  "text-7xl font-bold tracking-tighter text-foreground",
                  isOver && "text-red-400",
                )}
              >
                {netCalories}
              </span>
              <span className="text-xl font-medium text-muted-foreground uppercase tracking-widest">
                kcal
              </span>
            </div>
          </div>

          <div className="space-y-3 mt-auto">
            <div className="flex items-center gap-6">
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
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Protein
                </p>
                <p className="text-lg font-bold text-foreground">{protein}g</p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Carbs
                </p>
                <p className="text-lg font-bold text-foreground">{carbs}g</p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Fat
                </p>
                <p className="text-lg font-bold text-foreground">{fat}g</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Charts with Tabs */}
        <div
          className={cn(
            "border-t lg:border-t-0 lg:border-l border-white/[0.08] pt-8 lg:pt-0 lg:pl-8 flex flex-col justify-center transition-all duration-300",
            !showTrendsMobile && "hidden lg:flex",
          )}
        >
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
                  <TrendingUp className="h-3 w-3" /> Weight
                </TabsTrigger>
                <TabsTrigger
                  value="activity"
                  className="gap-2 text-[10px] uppercase tracking-wider h-6 px-3"
                >
                  <Activity className="h-3 w-3" /> Activity
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
                        Last 30D
                        <BarChart3 className="h-3.5 w-3.5" />
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
                ) : weightHistory && weightHistory.length > 0 ? (
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
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
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
                        dot={{ fill: "rgba(255,255,255,0.2)", r: 2 }}
                        activeDot={{ r: 4, strokeWidth: 0, fill: "#fff" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="trendWeight"
                        stroke="#fff"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0, fill: "#fff" }}
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
              {weightHistory?.[weightHistory.length - 1] && (
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
                ) : calorieHistory && calorieHistory.length > 0 ? (
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
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
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
                        activeDot={{ r: 4, strokeWidth: 0, fill: "#fff" }}
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
