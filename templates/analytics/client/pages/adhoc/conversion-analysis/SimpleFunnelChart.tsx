import { useMetricsQuery } from "@/lib/query-metrics";
import { getSimpleFunnelQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingDown } from "lucide-react";
import { SqlCodeToggle } from "./SqlCodeToggle";

interface SimpleFunnelChartProps {
  weeksRecent: number;
  weeksBaseline: number;
}

interface FunnelRow {
  period: string;
  total_visitors: number;
  visited_intent_page: number;
  intent_page_visit_rate: number;
  visited_signup_page: number;
  signup_page_visit_rate: number;
  completed_signups: number;
  signup_completion_rate: number;
  overall_conversion_rate: number;
}

export function SimpleFunnelChart({
  weeksRecent,
  weeksBaseline,
}: SimpleFunnelChartProps) {
  const sqlQuery = getSimpleFunnelQuery(weeksRecent, weeksBaseline);
  const { data, isLoading, error } = useMetricsQuery(
    ["simple-funnel", String(weeksRecent), String(weeksBaseline)],
    sqlQuery,
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Conversion Funnel Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">
            Error loading funnel data: {data?.error || String(error)}
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
            Conversion Funnel Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows as unknown as FunnelRow[];
  const recent = rows[0];
  const baseline = rows[1];

  const renderFunnel = (data: FunnelRow, label: string) => {
    const maxCount = data.total_visitors;

    const steps = [
      {
        label: "Total Visitors",
        count: data.total_visitors,
        pct: 100,
        rate: null,
      },
      {
        label: "Visited Intent Page (Signup/Pricing)",
        count: data.visited_intent_page ?? 0,
        pct:
          maxCount > 0 ? ((data.visited_intent_page ?? 0) / maxCount) * 100 : 0,
        rate: data.intent_page_visit_rate ?? null,
      },
      {
        label: "Visited Signup Page",
        count: data.visited_signup_page ?? 0,
        pct:
          maxCount > 0 ? ((data.visited_signup_page ?? 0) / maxCount) * 100 : 0,
        rate: data.signup_page_visit_rate ?? null,
      },
      {
        label: "Completed Signup",
        count: data.completed_signups ?? 0,
        pct:
          maxCount > 0 ? ((data.completed_signups ?? 0) / maxCount) * 100 : 0,
        rate: data.overall_conversion_rate ?? null,
      },
    ];

    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold text-muted-foreground">
          {label}
        </div>
        {steps.map((step, idx) => {
          const prevCount = idx > 0 ? steps[idx - 1].count : step.count;
          const dropoffCount = prevCount - step.count;
          const dropoffRate =
            prevCount > 0 ? (dropoffCount / prevCount) * 100 : 0;

          return (
            <div key={step.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{step.label}</span>
                  {idx > 0 && dropoffCount > 0 && (
                    <span className="flex items-center gap-1 text-orange-600">
                      <TrendingDown className="h-3 w-3" />
                      {dropoffCount.toLocaleString()} dropped (-
                      {dropoffRate.toFixed(1)}%)
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground">
                  {step.count.toLocaleString()} ({step.pct.toFixed(1)}%)
                </span>
              </div>
              <div className="relative h-10 rounded overflow-hidden bg-muted/30">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-blue-600 flex items-center px-2 transition-all"
                  style={{ width: `${step.pct}%` }}
                >
                  {step.rate !== null && (
                    <span className="text-xs font-medium text-white">
                      {step.rate.toFixed(1)}% conversion
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const recentConv = recent.overall_conversion_rate ?? 0;
  const baselineConv = baseline.overall_conversion_rate ?? 0;
  const convChange = recentConv - baselineConv;
  const convChangePct =
    baselineConv !== 0 ? (convChange / baselineConv) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conversion Funnel Analysis</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Comparison of user flow from visitors to completed signups
        </p>
      </CardHeader>
      <CardContent>
        {/* Summary */}
        <div className="mb-6 p-3 rounded-lg bg-muted/30 border border-border">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">
                Recent Overall Conv Rate
              </div>
              <div className="text-2xl font-bold mt-1">
                {recentConv.toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                Baseline Overall Conv Rate
              </div>
              <div className="text-2xl font-bold mt-1">
                {baselineConv.toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Change</div>
              <div
                className={`text-2xl font-bold mt-1 ${convChange < 0 ? "text-destructive" : "text-green-600"}`}
              >
                {convChange > 0 ? "+" : ""}
                {convChange.toFixed(2)}%
                <span className="text-sm ml-2 text-muted-foreground">
                  ({convChangePct > 0 ? "+" : ""}
                  {convChangePct.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Side-by-side Funnels */}
        <div className="grid md:grid-cols-2 gap-6">
          {renderFunnel(recent, `Recent (Last ${weeksRecent} Weeks)`)}
          {renderFunnel(
            baseline,
            `Baseline (Weeks ${weeksRecent + 1}-${weeksRecent + weeksBaseline} Ago)`,
          )}
        </div>

        {/* Key Findings */}
        <div className="mt-6 pt-4 border-t border-border text-xs">
          <div className="font-semibold mb-2">Key Findings:</div>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              • Intent Page Visit Rate:{" "}
              {(recent.intent_page_visit_rate ?? 0).toFixed(1)}% (vs{" "}
              {(baseline.intent_page_visit_rate ?? 0).toFixed(1)}%)
            </li>
            <li>
              • Signup Page Visit Rate:{" "}
              {(recent.signup_page_visit_rate ?? 0).toFixed(1)}% (vs{" "}
              {(baseline.signup_page_visit_rate ?? 0).toFixed(1)}%)
            </li>
            <li>
              • Signup Completion Rate:{" "}
              {(recent.signup_completion_rate ?? 0).toFixed(1)}% (vs{" "}
              {(baseline.signup_completion_rate ?? 0).toFixed(1)}%)
            </li>
          </ul>
        </div>

        <SqlCodeToggle sql={sqlQuery} title="View SQL Query" />
      </CardContent>
    </Card>
  );
}
