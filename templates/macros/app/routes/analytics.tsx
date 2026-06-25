import { useActionQuery, useT } from "@agent-native/core/client";
import { IconCalendar } from "@tabler/icons-react";
import { subDays } from "date-fns";
import { useState } from "react";
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

import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WeeklyCaloriesChart } from "@/components/WeeklyCaloriesChart";
import messages from "@/i18n/en-US";
import { formatLocalDate } from "@/lib/utils";

const GOAL_CALORIES = 2000;

export function meta() {
  const description = messages.seo.analyticsDescription;

  return [
    { title: messages.routeTitles.analytics },
    {
      name: "description",
      content: description,
    },
    { property: "og:description", content: description },
    { name: "twitter:description", content: description },
  ];
}

export default function AnalyticsPage() {
  const t = useT();
  const [timeRange, setTimeRange] = useState("30");

  useSetHeaderActions(
    <Select value={timeRange} onValueChange={setTimeRange}>
      <SelectTrigger className="w-[130px] sm:w-[140px] bg-card/40 border-border/30 h-8 text-xs shrink-0">
        <IconCalendar className="w-3.5 h-3.5 me-1.5 sm:me-2 opacity-50" />
        <SelectValue placeholder={t("analytics.selectRange")} />
      </SelectTrigger>
      <SelectContent className="bg-zinc-900 border-white/10">
        <SelectItem value="7">
          {t("analytics.lastDays", { count: 7 })}
        </SelectItem>
        <SelectItem value="30">
          {t("analytics.lastDays", { count: 30 })}
        </SelectItem>
        <SelectItem value="90">
          {t("analytics.lastDays", { count: 90 })}
        </SelectItem>
        <SelectItem value="all">{t("analytics.allTime")}</SelectItem>
      </SelectContent>
    </Select>,
  );

  const getStartDate = (range: string) => {
    if (range === "all") return "2000-01-01";
    return formatLocalDate(subDays(new Date(), parseInt(range)));
  };

  const endDate = formatLocalDate(new Date());
  const startDate = getStartDate(timeRange);

  const { data: rawHistory, isLoading } = useActionQuery("meals-history", {
    startDate,
    endDate,
  });
  const history = Array.isArray(rawHistory) ? rawHistory : [];

  const { data: rawWeightHistory, isLoading: weightLoading } = useActionQuery(
    "weights-history",
    { startDate, endDate },
  );
  const weightHistory = Array.isArray(rawWeightHistory) ? rawWeightHistory : [];

  const weightStats = {
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
  };

  const getWeightYDomain = () => {
    if (weightHistory.length === 0) return [0, 200];
    const ws = weightHistory.map((h) => h.weight);
    const min = Math.min(...ws);
    const max = Math.max(...ws);
    const padding = (max - min) * 0.3 || 5;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  };

  const stats = {
    average:
      history.length > 0
        ? Math.round(
            history.reduce((sum, day) => sum + day.netCalories, 0) /
              history.length,
          )
        : 0,
    highest:
      history.length > 0
        ? Math.max(...history.map((day) => day.netCalories))
        : 0,
    lowest:
      history.length > 0
        ? Math.min(...history.map((day) => day.netCalories))
        : 0,
    total: history.length,
  };

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
  };

  return (
    <div className="min-h-screen pb-20 relative z-10">
      <div className="max-w-2xl lg:max-w-4xl mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: t("analytics.average"), value: stats.average },
            { label: t("analytics.lowest"), value: stats.lowest },
            { label: t("analytics.highest"), value: stats.highest },
            {
              label: t("analytics.daysTracked"),
              value: stats.total,
              unit: t("analytics.daysUnit"),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-3 sm:p-4 rounded-xl bg-card/40 border border-border/30"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5 sm:mb-2">
                {stat.label}
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-bold text-foreground">
                  {stat.value}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stat.unit || "kcal"}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Calorie Trend Chart */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-md overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">
              Calorie Trend (
              {timeRange === "all"
                ? t("analytics.allTime")
                : t("analytics.lastDays", { count: Number(timeRange) })}
              )
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="net" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-4 sm:mb-6 bg-secondary/40">
                <TabsTrigger value="net">{t("analytics.net")}</TabsTrigger>
                <TabsTrigger value="consumed">
                  {t("analytics.consumed")}
                </TabsTrigger>
                <TabsTrigger value="burned">
                  {t("analytics.burned")}
                </TabsTrigger>
              </TabsList>
              {["net", "consumed", "burned"].map((tab) => (
                <TabsContent key={tab} value={tab} className="mt-0">
                  {isLoading ? (
                    <Skeleton className="h-[250px] w-full rounded-xl" />
                  ) : history.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
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
                          contentStyle={tooltipStyle}
                          itemStyle={{ fontSize: "12px" }}
                          labelStyle={{
                            fontSize: "12px",
                            color: "hsl(var(--muted-foreground))",
                            marginBottom: "4px",
                          }}
                          formatter={(value: any) => [
                            `${value} kcal`,
                            tab === "net"
                              ? "Net Calories"
                              : tab === "consumed"
                                ? "Consumed"
                                : "Burned",
                          ]}
                        />
                        {tab !== "burned" && (
                          <ReferenceLine
                            y={GOAL_CALORIES}
                            stroke="hsl(var(--foreground))"
                            strokeDasharray="3 3"
                            strokeOpacity={0.3}
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey={
                            tab === "net"
                              ? "netCalories"
                              : tab === "consumed"
                                ? "totalCalories"
                                : "burnedCalories"
                          }
                          stroke={
                            tab === "burned"
                              ? "#ea580c"
                              : "hsl(var(--foreground))"
                          }
                          strokeWidth={2}
                          dot={false}
                          activeDot={{
                            r: 4,
                            strokeWidth: 0,
                            fill:
                              tab === "burned"
                                ? "#ea580c"
                                : "hsl(var(--foreground))",
                          }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[250px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
                      <p className="text-sm">{t("analytics.noData")}</p>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {/* Weekly Net Calories */}
        <Card className="border-border/40 bg-card/60 backdrop-blur-md overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">
              Weekly Net Calories vs Goal (
              {timeRange === "all"
                ? t("analytics.allTime")
                : t("analytics.lastDays", { count: Number(timeRange) })}
              )
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
              Weight Trend (
              {timeRange === "all"
                ? t("analytics.allTime")
                : t("analytics.lastDays", { count: Number(timeRange) })}
              )
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
              {[
                { label: t("analytics.current"), value: weightStats.current },
                {
                  label: t("analytics.change"),
                  value: weightStats.change,
                  colored: true,
                },
                { label: t("analytics.lowest"), value: weightStats.lowest },
                { label: t("analytics.highest"), value: weightStats.highest },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-3 rounded-lg bg-secondary/30"
                >
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
                    {stat.label}
                  </p>
                  <div className="flex items-baseline gap-1">
                    <span
                      className={`text-lg font-bold ${
                        stat.colored
                          ? stat.value < 0
                            ? "text-green-500"
                            : stat.value > 0
                              ? "text-orange-500"
                              : "text-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {stat.colored && stat.value > 0 ? "+" : ""}
                      {stat.value}
                    </span>
                    <span className="text-xs text-muted-foreground">lbs</span>
                  </div>
                </div>
              ))}
            </div>

            <Tabs defaultValue="trend" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4 sm:mb-6 bg-secondary/40">
                <TabsTrigger value="trend">
                  {t("analytics.trendView")}
                </TabsTrigger>
                <TabsTrigger value="actual">
                  {t("analytics.actualWeight")}
                </TabsTrigger>
              </TabsList>
              {["trend", "actual"].map((tab) => (
                <TabsContent key={tab} value={tab} className="mt-0">
                  {weightLoading ? (
                    <Skeleton className="h-[250px] w-full rounded-xl" />
                  ) : weightHistory.length > 0 ? (
                    <div className="space-y-2">
                      {tab === "trend" && (
                        <p className="text-xs text-muted-foreground">
                          {t("analytics.trendDescription")}
                        </p>
                      )}
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart
                          data={weightHistory}
                          margin={{
                            top: 5,
                            right: 5,
                            bottom: 5,
                            left: -20,
                          }}
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
                            contentStyle={tooltipStyle}
                            itemStyle={{ fontSize: "12px" }}
                            labelStyle={{
                              fontSize: "12px",
                              color: "hsl(var(--muted-foreground))",
                              marginBottom: "4px",
                            }}
                            formatter={(value: any, name: any) => [
                              `${value} lbs`,
                              tab === "trend"
                                ? name === "trendWeight"
                                  ? "Trend"
                                  : "Actual"
                                : "Weight",
                            ]}
                          />
                          {tab === "trend" ? (
                            <>
                              <Line
                                type="monotone"
                                dataKey="weight"
                                stroke="hsl(var(--muted-foreground))"
                                strokeWidth={0}
                                dot={{
                                  fill: "hsl(var(--foreground))",
                                  r: 3,
                                }}
                                activeDot={{ r: 5, strokeWidth: 0 }}
                              />
                              <Line
                                type="monotone"
                                dataKey="trendWeight"
                                stroke="#3b82f6"
                                strokeWidth={2.5}
                                dot={false}
                                activeDot={{
                                  r: 5,
                                  strokeWidth: 0,
                                  fill: "#3b82f6",
                                }}
                              />
                            </>
                          ) : (
                            <Line
                              type="linear"
                              dataKey="weight"
                              stroke="hsl(var(--foreground))"
                              strokeWidth={2}
                              dot={{
                                fill: "hsl(var(--foreground))",
                                r: 3,
                              }}
                              activeDot={{
                                r: 5,
                                strokeWidth: 0,
                                fill: "hsl(var(--foreground))",
                              }}
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[250px] flex flex-col items-center justify-center text-muted-foreground rounded-xl border border-dashed border-border/50 bg-secondary/20">
                      <p className="text-sm">{t("analytics.noWeightData")}</p>
                      <p className="text-xs mt-1">
                        {t("analytics.noWeightDescription")}
                      </p>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
