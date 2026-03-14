import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import {
  type DateRange,
  formatDate,
  CHART_AXIS_STYLE,
  TOOLTIP_STYLE,
  GRID_STYLE,
} from "./queries";
import { ChartTitleWithInfo } from "./ChartTitle";

const TABLE_PR = "`builder-3b0a2.dbt_staging_firestore.pr_reviews`";
const TABLE_VCE = "`builder-3b0a2.dbt_staging_firestore.vcp_code_events`";

function feedbackSql(range: DateRange) {
  const dateFilter =
    range === "all"
      ? ""
      : `AND pr.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${parseInt(range)} DAY)`;

  return `SELECT
  vce.feedback_sentiment,
  COUNT(*) AS cnt
FROM ${TABLE_PR} pr
JOIN ${TABLE_VCE} vce
  ON pr.pr_review_id = vce.vcp_code_gen_id
WHERE pr.created_at IS NOT NULL
  AND pr.created_at <= CURRENT_TIMESTAMP()
  AND vce.feedback_sentiment IS NOT NULL
  ${dateFilter}
GROUP BY vce.feedback_sentiment
ORDER BY cnt DESC`;
}

function feedbackOverTimeSql(range: DateRange) {
  const dateFilter =
    range === "all"
      ? ""
      : `AND pr.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${parseInt(range)} DAY)`;

  return `SELECT
  DATE(pr.created_at) AS day,
  COUNTIF(vce.feedback_sentiment = 'positive') AS thumbs_up,
  COUNTIF(vce.feedback_sentiment = 'negative') AS thumbs_down
FROM ${TABLE_PR} pr
JOIN ${TABLE_VCE} vce
  ON pr.pr_review_id = vce.vcp_code_gen_id
WHERE pr.created_at IS NOT NULL
  AND pr.created_at <= CURRENT_TIMESTAMP()
  AND vce.feedback_sentiment IN ('positive', 'negative')
  ${dateFilter}
GROUP BY day
ORDER BY day ASC`;
}

interface Props {
  dateRange: DateRange;
}

export function FeedbackChart({ dateRange }: Props) {
  const totals = useMetricsQuery(
    ["pr-review-feedback-totals", dateRange],
    feedbackSql(dateRange)
  );

  const series = useMetricsQuery(
    ["pr-review-feedback-time", dateRange],
    feedbackOverTimeSql(dateRange)
  );

  const kpis = useMemo(() => {
    const rows = totals.data?.rows ?? [];
    let positive = 0;
    let negative = 0;
    for (const r of rows) {
      if (r.feedback_sentiment === "positive") positive = Number(r.cnt);
      if (r.feedback_sentiment === "negative") negative = Number(r.cnt);
    }
    return { positive, negative, total: positive + negative };
  }, [totals.data]);

  const chartData = useMemo(
    () =>
      (series.data?.rows ?? []).map((r) => ({
        day: r.day as string,
        thumbs_up: Number(r.thumbs_up || 0),
        thumbs_down: Number(r.thumbs_down || 0),
      })),
    [series.data]
  );

  const loading = totals.isLoading || series.isLoading;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <ChartTitleWithInfo
              title="Reaction Feedback on Review Comments"
              description="Thumbs up/down emoji reactions left by developers on the bot's review comments. Only collected when a PR is merged or closed."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Thumbs up/down reactions on PR review comments. Data is only
              collected when a PR is merged or closed.
            </p>
          </div>
          {!loading && (
            <div className="flex items-center gap-3 shrink-0 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="text-base">👍</span>
                <span className="font-semibold tabular-nums">
                  {kpis.positive}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-base">👎</span>
                <span className="font-semibold tabular-nums">
                  {kpis.negative}
                </span>
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No reaction data available yet
          </p>
        ) : (
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <XAxis
                  dataKey="day"
                  {...CHART_AXIS_STYLE}
                  tickFormatter={formatDate}
                />
                <YAxis {...CHART_AXIS_STYLE} allowDecimals={false} />
                <CartesianGrid {...GRID_STYLE} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={formatDate}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                <Bar
                  dataKey="thumbs_up"
                  name="👍 Positive"
                  stackId="feedback"
                  fill="#22c55e"
                  maxBarSize={32}
                />
                <Bar
                  dataKey="thumbs_down"
                  name="👎 Negative"
                  stackId="feedback"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
