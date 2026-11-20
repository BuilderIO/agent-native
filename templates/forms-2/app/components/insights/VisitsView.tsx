import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";

import { formatDuration, type Period } from "@/components/forms/insights";
import { ErrorPanel } from "@/components/forms/NotFoundPanel";
import { Skeleton } from "@/components/ui/skeleton";

import { MetricRow } from "./MetricCard";

function bucketLabel(start: string, unit: "hour" | "day") {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(unit === "hour" ? { hour: "numeric" } : {}),
  }).format(new Date(start));
}

export function VisitsView({
  formId,
  period,
}: {
  formId: string;
  period: Period;
}) {
  const t = useT();
  const insights = useActionQuery("get-form-insights", { formId, period });
  const series = useActionQuery("get-form-visit-series", { formId, period });
  const data = insights.data;

  if (insights.error || series.error)
    return (
      <ErrorPanel
        onRetry={() => {
          void insights.refetch();
          void series.refetch();
        }}
      />
    );

  const peak = Math.max(
    1,
    ...(series.data?.buckets.map((b) => b.visits) ?? []),
  );
  const buckets = series.data?.buckets ?? [];
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <>
      <MetricRow
        ready={!!data}
        metrics={[
          [t("forms.insights.visits"), `${data?.visits}`],
          [t("forms.insights.submissions"), `${data?.submissions}`],
          [t("forms.insights.uniqueRespondents"), `${data?.uniqueRespondents}`],
          [
            t("forms.insights.visitDuration"),
            formatDuration(data?.visitDurationMs ?? null),
          ],
        ]}
      />
      <h2 className="mb-3 text-sm font-bold">
        {t("forms.insightViews.visitsOverTime")}
      </h2>
      {!series.data ? (
        <Skeleton className="h-40 w-full" />
      ) : buckets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("forms.insightViews.noVisits")}
        </p>
      ) : (
        <div>
          <div
            role="img"
            aria-label={t("forms.insightViews.visitsOverTime")}
            className="flex h-40 items-end gap-1 border-b border-b-border"
          >
            {buckets.map((bucket) => (
              <div
                key={bucket.start}
                title={`${bucketLabel(bucket.start, series.data.unit)}: ${bucket.visits}`}
                className="max-w-10 min-w-[3px] flex-1 rounded-t-[3px] bg-foreground"
                style={{
                  height: `${Math.max(2, (bucket.visits / peak) * 100)}%`,
                  opacity: bucket.visits === 0 ? 0.15 : 1,
                }}
              />
            ))}
          </div>
          {first && last ? (
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>{bucketLabel(first.start, series.data.unit)}</span>
              <span>{bucketLabel(last.start, series.data.unit)}</span>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
