import { useMetricsQuery } from "@/lib/query-metrics";
import { getDropoffAnalysisQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";

interface DropoffAnalysisChartProps {
  dateStart: string;
  dateEnd: string;
}

interface DropoffData {
  signup_count: number;
  dropoff_after_signup: number;
  dropoff_after_shown: number;
  dropoff_after_steps: number;
  dropoff_after_next: number;
  dropoff_after_kind: number;
}

export function DropoffAnalysisChart({ dateStart, dateEnd }: DropoffAnalysisChartProps) {
  const { data, isLoading, error } = useMetricsQuery(
    ["dropoff-analysis", dateStart, dateEnd],
    getDropoffAnalysisQuery(dateStart, dateEnd)
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drop-off Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">Error loading data: {data?.error || String(error)}</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data || data.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drop-off Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const dropoffData = data.rows[0] as unknown as DropoffData;
  const totalSignups = dropoffData.signup_count;

  const dropoffs = [
    {
      stage: "After Signup → Before Onboarding Shown",
      count: dropoffData.dropoff_after_signup,
      percentage: (dropoffData.dropoff_after_signup / totalSignups) * 100
    },
    {
      stage: "After Shown → Before Steps Viewed",
      count: dropoffData.dropoff_after_shown,
      percentage: (dropoffData.dropoff_after_shown / totalSignups) * 100
    },
    {
      stage: "After Steps → Before Next Click",
      count: dropoffData.dropoff_after_steps,
      percentage: (dropoffData.dropoff_after_steps / totalSignups) * 100
    },
    {
      stage: "After Next → Before Space Kind",
      count: dropoffData.dropoff_after_next,
      percentage: (dropoffData.dropoff_after_next / totalSignups) * 100
    },
    {
      stage: "After Space Kind → Before Complete",
      count: dropoffData.dropoff_after_kind,
      percentage: (dropoffData.dropoff_after_kind / totalSignups) * 100
    }
  ].sort((a, b) => b.count - a.count);

  const maxDropoff = dropoffs[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Drop-off Analysis</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Identify where users abandon the onboarding flow
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {dropoffs.map((dropoff, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {dropoff.count === maxDropoff.count && (
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  )}
                  <span className={dropoff.count === maxDropoff.count ? "font-semibold" : ""}>
                    {dropoff.stage}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {dropoff.count.toLocaleString()} users
                  </span>
                  <span className="font-semibold text-red-600 min-w-[50px] text-right">
                    {dropoff.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="relative h-8 rounded-md overflow-hidden bg-muted/30">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-500 to-red-600"
                  style={{ width: `${(dropoff.count / maxDropoff.count) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Key Insights */}
        <div className="mt-6 pt-4 border-t border-border space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <div className="text-xs">
              <span className="font-semibold text-foreground">Biggest Drop-off:</span>
              <span className="text-muted-foreground ml-1">
                {maxDropoff.stage} — {maxDropoff.count.toLocaleString()} users ({maxDropoff.percentage.toFixed(1)}% of signups)
              </span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Total signups analyzed: <span className="font-semibold text-foreground">{totalSignups.toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
