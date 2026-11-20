import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";

import {
  formatDuration,
  formatRate,
  type Period,
} from "@/components/forms/insights";
import { ErrorPanel } from "@/components/forms/NotFoundPanel";
import { Skeleton } from "@/components/ui/skeleton";

import { MetricRow } from "./MetricCard";

export function DropoffsView({
  formId,
  period,
}: {
  formId: string;
  period: Period;
}) {
  const t = useT();
  const insights = useActionQuery("get-form-insights", { formId, period });
  const dropoffs = useActionQuery("get-form-dropoffs", { formId, period });
  const data = insights.data;

  if (insights.error || dropoffs.error)
    return (
      <ErrorPanel
        onRetry={() => {
          void insights.refetch();
          void dropoffs.refetch();
        }}
      />
    );

  const rows = dropoffs.data?.questions.filter(
    (row) => !row.question.isDeleted,
  );

  return (
    <>
      <MetricRow
        ready={!!data}
        metrics={[
          [t("forms.insightViews.startedAnswering"), `${data?.starts}`],
          [t("forms.insightViews.completions"), `${data?.submissions}`],
          [
            t("forms.insightViews.completionRate"),
            formatRate(data?.completionRate ?? 0),
          ],
          [
            t("forms.insightViews.completionDuration"),
            formatDuration(data?.completionDurationMs ?? null),
          ],
        ]}
      />
      <h2 className="mb-3 text-sm font-bold">
        {t("forms.insightViews.byQuestion")}
      </h2>
      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("forms.insightViews.noQuestions")}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-b-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">
                {t("forms.insightViews.question")}
              </th>
              <th className="w-28 py-2 pr-4 text-right font-medium">
                {t("forms.insightViews.answered")}
              </th>
              <th className="w-28 py-2 text-right font-medium">
                {t("forms.insightViews.droppedOff")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.question.id} className="border-b border-b-border">
                <td className="py-2.5 pr-4">
                  {row.question.title || t("forms.insights.untitled")}
                </td>
                <td className="py-2.5 pr-4 text-right">{row.answered}</td>
                <td className="py-2.5 text-right">{row.droppedOff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
