import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";
import { Link } from "react-router";

import { useFormOutlet } from "@/components/forms/form-data";
import { formatDuration, type Period } from "@/components/forms/insights";
import { ErrorPanel } from "@/components/forms/NotFoundPanel";
import { PageColumn } from "@/components/shell/PageColumn";
import { paths } from "@/components/shell/paths";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { DropoffsView } from "./DropoffsView";
import { MetricRow } from "./MetricCard";
import { PeriodMenu } from "./PeriodMenu";
import { QuestionCard } from "./QuestionCard";
import { VisitsView } from "./VisitsView";

const VIEWS = ["answers", "visits", "dropoffs"] as const;
type View = (typeof VIEWS)[number];

export function InsightsPage() {
  const t = useT();
  const form = useFormOutlet();
  const [period, setPeriod] = useState<Period>("all");
  const [view, setView] = useState<View>("answers");
  const { data, error, refetch } = useActionQuery("get-form-insights", {
    formId: form.id,
    period,
  });

  const metrics = [
    [t("forms.insights.visits"), `${data?.visits}`],
    [t("forms.insights.submissions"), `${data?.submissions}`],
    [t("forms.insights.uniqueRespondents"), `${data?.uniqueRespondents}`],
    [
      t("forms.insights.visitDuration"),
      formatDuration(data?.visitDurationMs ?? null),
    ],
  ] as const;
  const isEmpty = data?.visits === 0 && data.submissions === 0;
  const viewLabel = (key: View) =>
    key === "answers"
      ? t("forms.insights.answers")
      : key === "visits"
        ? t("forms.insights.visits")
        : t("forms.insightViews.dropoffs");

  return (
    <PageColumn className="pt-[23px] pb-16">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex gap-2.5">
          {VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={cn(
                "h-[30px] rounded-[15px] px-3 text-sm leading-[16.1px] font-semibold",
                view === key
                  ? "bg-[var(--forms-solid)] text-[color:var(--forms-solid-text)]"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {viewLabel(key)}
            </button>
          ))}
        </div>
        <PeriodMenu period={period} onChange={setPeriod} />
      </div>

      {view === "visits" ? (
        <VisitsView formId={form.id} period={period} />
      ) : null}
      {view === "dropoffs" ? (
        <DropoffsView formId={form.id} period={period} />
      ) : null}
      {view !== "answers" ? null : error ? (
        <div className="mt-5">
          <ErrorPanel onRetry={() => void refetch()} />
        </div>
      ) : (
        <MetricRow metrics={metrics} ready={!!data} />
      )}

      {view === "answers" && isEmpty ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <p className="text-base font-semibold">
            {t("forms.insights.emptyTitle")}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("forms.insights.emptyBody")}
          </p>
          <Button variant="ghost" asChild>
            <Link to={paths.formTab(form.id, "share")}>
              {t("forms.insights.share")}
            </Link>
          </Button>
        </div>
      ) : null}

      {view === "answers" && !data && !error ? (
        <div role="status" aria-label={t("forms.insights.loading")}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="mt-8 h-24 w-full" />
          ))}
        </div>
      ) : null}
      {view === "answers" && data && !isEmpty
        ? data.questions.map((question) => (
            <QuestionCard
              key={question.id}
              formId={form.id}
              period={period}
              question={question}
            />
          ))
        : null}
    </PageColumn>
  );
}
