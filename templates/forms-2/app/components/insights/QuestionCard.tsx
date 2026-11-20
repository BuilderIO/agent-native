import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChartDonut, IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

import type { Period } from "@/components/forms/insights";
import { UnpublishedBadge } from "@/components/forms/UnpublishedBadge";
import { relativeTime } from "@/components/shell/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { RATING_VIEWS, ratingViewLabel, type RatingView } from "./rating-stats";
import { RatingChart } from "./RatingChart";

function ChartMenu({
  view,
  onChange,
}: {
  view: RatingView;
  onChange: (view: RatingView) => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("forms.insights.chartType")}
          className="-mr-2 ml-auto flex h-6 items-center gap-[5px] rounded-full pr-2 pl-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          <span className="flex gap-1.5">
            <IconChartDonut aria-hidden className="size-3" />
            <span>{ratingViewLabel(t, view)}</span>
          </span>
          <span className="flex">
            <IconChevronDown className="size-3" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={view}
          onValueChange={(value) => onChange(value as RatingView)}
        >
          {RATING_VIEWS.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {ratingViewLabel(t, key)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function QuestionCard({
  formId,
  period,
  question,
}: {
  formId: string;
  period: Period;
  question: { id: string; title: string; isDeleted: boolean };
}) {
  const t = useT();
  const { data } = useActionQuery("get-question-summary", {
    formId,
    questionId: question.id,
    period,
  });
  const [view, setView] = useState<RatingView>("average");
  const isRating = data ? data.average !== null : false;
  const peak = Math.max(1, ...(data?.choices.map((c) => c.count) ?? []));

  return (
    <section className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex h-[18px] items-center gap-1">
          <div className="flex items-center gap-[5px]">
            <span
              role="heading"
              aria-level={3}
              className="text-base leading-[18.4px] font-bold"
            >
              {question.title || t("forms.insights.untitled")}
            </span>
            {question.isDeleted ? <UnpublishedBadge /> : null}
          </div>
          {isRating ? <ChartMenu view={view} onChange={setView} /> : null}
        </div>
        <span className="flex gap-[5px] text-sm leading-[16.1px] text-[color:var(--forms-ink-faint)]">
          {data
            ? t("forms.insights.answerCount", { count: data.answerCount })
            : "…"}
        </span>
      </div>
      {!data ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <div className="flex flex-col gap-[10px]">
          <div className={cn("flex flex-col", isRating && "gap-8")}>
            {isRating ? (
              <RatingChart
                view={view}
                entries={data.distribution}
                average={data.average}
              />
            ) : null}
            {data.choices.length > 0 ? (
              <ul className="flex flex-col gap-2.5">
                {data.choices.map((choice) => (
                  <li key={choice.optionId} className="text-sm">
                    <div className="flex justify-between">
                      <span>{choice.text}</span>
                      <span className="text-muted-foreground">
                        {choice.count}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-primary"
                        style={{ width: `${(choice.count / peak) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {data.recent.map((row) => (
              <div
                key={row.submissionId}
                className="flex items-center justify-between border-t border-transparent py-[10px]"
              >
                <span className="min-w-0 truncate text-base leading-[18.4px]">
                  {row.text}
                </span>
                <span className="shrink-0 pl-4 text-sm leading-[16.1px] text-[color:var(--forms-ink-faint)]">
                  {relativeTime(row.submittedAt, t)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
