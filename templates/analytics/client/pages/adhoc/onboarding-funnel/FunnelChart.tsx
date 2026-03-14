import { useMetricsQuery } from "@/lib/query-metrics";
import { getFunnelOverviewQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingDown } from "lucide-react";

interface FunnelChartProps {
  dateStart: string;
  dateEnd: string;
}

interface FunnelStep {
  step: string;
  step_order: number;
  users: number;
}

export function FunnelChart({ dateStart, dateEnd }: FunnelChartProps) {
  const { data, isLoading, error } = useMetricsQuery(
    ["funnel-overview", dateStart, dateEnd],
    getFunnelOverviewQuery(dateStart, dateEnd)
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onboarding Funnel Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">Error loading funnel data: {data?.error || String(error)}</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onboarding Funnel Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(7)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const steps = (data.rows as unknown as FunnelStep[]).sort((a, b) => a.step_order - b.step_order);
  const maxUsers = steps[0]?.users || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Onboarding Funnel Overview</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          User progression through onboarding steps with conversion rates
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {steps.map((step, idx) => {
            const prevUsers = idx > 0 ? steps[idx - 1].users : step.users;
            const conversionRate = prevUsers > 0 ? (step.users / prevUsers) * 100 : 100;
            const overallRate = (step.users / maxUsers) * 100;
            const dropoffCount = prevUsers - step.users;
            const dropoffRate = prevUsers > 0 ? ((prevUsers - step.users) / prevUsers) * 100 : 0;

            return (
              <div key={step.step} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{step.step}</span>
                    {idx > 0 && dropoffCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-orange-600">
                        <TrendingDown className="h-3 w-3" />
                        {dropoffCount.toLocaleString()} dropped (-{dropoffRate.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-xs">
                      {step.users.toLocaleString()} users
                    </span>
                    <span className="font-semibold text-blue-600">
                      {conversionRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="relative h-12 rounded-md overflow-hidden bg-muted/30">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-between px-3 transition-all"
                    style={{ width: `${overallRate}%` }}
                  >
                    <span className="text-xs font-medium text-white">
                      {overallRate.toFixed(1)}% of total
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary Stats */}
        <div className="mt-6 pt-4 border-t border-border grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Total Started</div>
            <div className="text-2xl font-bold">{steps[0]?.users.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completed</div>
            <div className="text-2xl font-bold">{steps[steps.length - 1]?.users.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Overall Completion Rate</div>
            <div className="text-2xl font-bold text-blue-600">
              {((steps[steps.length - 1]?.users / maxUsers) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
