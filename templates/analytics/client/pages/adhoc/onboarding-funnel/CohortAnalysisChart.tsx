import { useMetricsQuery } from "@/lib/query-metrics";
import { getCohortAnalysisQuery } from "./queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface CohortAnalysisChartProps {
  dateStart: string;
  dateEnd: string;
  dimension: "week" | "space_kind" | "plan";
}

interface CohortData {
  cohort: string;
  total_signups: number;
  onboarding_shown: number;
  viewed_steps: number;
  completed_onboarding: number;
  pct_shown: number;
  pct_steps: number;
  pct_completed: number;
}

const dimensionLabels = {
  week: "Week",
  space_kind: "Product Type",
  plan: "Plan/Tier",
};

export function CohortAnalysisChart({
  dateStart,
  dateEnd,
  dimension,
}: CohortAnalysisChartProps) {
  const { data, isLoading, error } = useMetricsQuery(
    ["cohort-analysis", dateStart, dateEnd, dimension],
    getCohortAnalysisQuery(dateStart, dateEnd, dimension),
  );

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cohort Analysis</CardTitle>
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
          <CardTitle className="text-base">Cohort Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const rows = data.rows as unknown as CohortData[];
  const dimensionLabel = dimensionLabels[dimension];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Cohort Analysis by {dimensionLabel}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Conversion rates across different {dimensionLabel.toLowerCase()}{" "}
          cohorts
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-semibold sticky left-0 bg-card">
                  {dimensionLabel}
                </th>
                <th className="text-right py-2 font-semibold">Signups</th>
                <th className="text-right py-2 font-semibold">Shown</th>
                <th className="text-right py-2 font-semibold">% Shown</th>
                <th className="text-right py-2 font-semibold">Viewed Steps</th>
                <th className="text-right py-2 font-semibold">% Steps</th>
                <th className="text-right py-2 font-semibold">Completed</th>
                <th className="text-right py-2 font-semibold">% Completed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-border/50 hover:bg-muted/50"
                >
                  <td className="py-2 font-medium sticky left-0 bg-card">
                    {row.cohort}
                  </td>
                  <td className="text-right py-2">
                    {row.total_signups.toLocaleString()}
                  </td>
                  <td className="text-right py-2">
                    {row.onboarding_shown.toLocaleString()}
                  </td>
                  <td className="text-right py-2">
                    <span
                      className={
                        row.pct_shown < 50
                          ? "text-red-600"
                          : row.pct_shown < 80
                            ? "text-orange-600"
                            : "text-green-600"
                      }
                    >
                      {row.pct_shown}%
                    </span>
                  </td>
                  <td className="text-right py-2">
                    {row.viewed_steps.toLocaleString()}
                  </td>
                  <td className="text-right py-2">
                    <span
                      className={
                        row.pct_steps < 40
                          ? "text-red-600"
                          : row.pct_steps < 70
                            ? "text-orange-600"
                            : "text-green-600"
                      }
                    >
                      {row.pct_steps}%
                    </span>
                  </td>
                  <td className="text-right py-2 font-semibold">
                    {row.completed_onboarding.toLocaleString()}
                  </td>
                  <td className="text-right py-2 font-semibold">
                    <span
                      className={
                        row.pct_completed < 30
                          ? "text-red-600"
                          : row.pct_completed < 60
                            ? "text-orange-600"
                            : "text-green-600"
                      }
                    >
                      {row.pct_completed}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        {rows.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Total Cohorts</div>
              <div className="text-lg font-bold">{rows.length}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Avg Completion Rate</div>
              <div className="text-lg font-bold text-blue-600">
                {(
                  rows.reduce((sum, d) => sum + d.pct_completed, 0) /
                  rows.length
                ).toFixed(1)}
                %
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Best Cohort</div>
              <div className="text-lg font-bold text-green-600">
                {Math.max(...rows.map((d) => d.pct_completed)).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Worst Cohort</div>
              <div className="text-lg font-bold text-red-600">
                {Math.min(...rows.map((d) => d.pct_completed)).toFixed(1)}%
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
