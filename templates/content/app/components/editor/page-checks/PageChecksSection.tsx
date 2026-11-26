import { useT } from "@agent-native/core/client/i18n";
import {
  PAGE_CHECK_LIMIT,
  type PageCheckPlaceAnswer,
  type PageCheckView,
} from "@shared/page-checks";
import { IconDots } from "@tabler/icons-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  pageCheckMarkShape,
  shownPageCheckAnswers,
  type LivePageChecks,
} from "./page-check-body";
import { pageCheckScopeLabel, pageCheckSummaryText } from "./page-check-format";
import {
  usePageChecksActions,
  usePageChecksState,
  type PageChecksActions,
} from "./page-checks-context";

type ListedAnswer = PageCheckPlaceAnswer & { writing?: boolean };

export function pageCheckAnswersNow(
  check: PageCheckView,
  live: LivePageChecks | null,
): ListedAnswer[] {
  return live?.answers.get(check.id) ?? check.answers;
}

export function pageChecksToLookAt(
  checks: readonly PageCheckView[],
  live: LivePageChecks | null,
): number {
  return checks.reduce(
    (total, check) =>
      total +
      shownPageCheckAnswers(check, pageCheckAnswersNow(check, live)).length,
    0,
  );
}

export function PageChecksSection() {
  const t = useT();
  const actions = usePageChecksActions();
  const state = usePageChecksState();
  const headingId = useId();
  if (!actions?.enabled || !state) return null;
  const { checks } = state;
  return (
    <section
      className="mt-6 grid gap-2 border-t border-border px-2 pt-3 outline-none"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-page-checks
    >
      <div className="flex min-h-8 items-center gap-2">
        <h3
          id={headingId}
          className="text-xs font-medium text-muted-foreground"
        >
          {t("pageChecks.title")}
        </h3>
        <span className="flex-1" />
        {actions.canEdit && checks.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={state.running}
            onClick={actions.runNow}
          >
            {state.running
              ? t("pageChecks.checking")
              : t("pageChecks.checkNow")}
          </Button>
        ) : null}
        {actions.canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={checks.length >= PAGE_CHECK_LIMIT}
            title={
              checks.length >= PAGE_CHECK_LIMIT
                ? t("pageChecks.limit")
                : undefined
            }
            onClick={() => actions.openAdd()}
          >
            {t("pageChecks.add")}
          </Button>
        ) : null}
      </div>
      {state.loading ? (
        <div
          className="h-4 w-32 animate-pulse rounded bg-muted/40"
          role="status"
          aria-label={t("pageChecks.checking")}
        />
      ) : state.loadFailed ? (
        <p className="text-xs text-destructive">{t("pageChecks.loadFailed")}</p>
      ) : checks.length === 0 ? (
        <p className="text-xs text-muted-foreground [text-wrap:pretty]">
          {t("pageChecks.empty")}
        </p>
      ) : (
        <ul className="grid">
          {checks.map((check) => (
            <PageCheckRow
              key={check.id}
              actions={actions}
              check={check}
              answers={pageCheckAnswersNow(check, state.live)}
            />
          ))}
        </ul>
      )}
      {state.runFailed ? (
        <p className="text-xs text-destructive" role="status">
          {t("pageChecks.runFailed")}
        </p>
      ) : null}
    </section>
  );
}

function PageCheckRow({
  actions,
  check,
  answers,
}: {
  actions: PageChecksActions;
  check: PageCheckView;
  answers: ListedAnswer[];
}) {
  const t = useT();
  const shown = shownPageCheckAnswers(check, answers);
  const skipped = answers.filter((answer) => answer.answer === "skipped");
  const summary = check.paused
    ? t("pageChecks.paused")
    : pageCheckSummaryText(
        t,
        check.parts,
        answers.filter(
          (answer) => !(answer.writing && answer.answer === "changed"),
        ),
        check.scope.kind === "each_paragraph",
      );
  const content = (
    <>
      {shown[0] ? (
        <span
          aria-hidden="true"
          className="page-check-dot mt-[0.45em]"
          data-shape={pageCheckMarkShape(shown[0].answer)}
        />
      ) : (
        <span aria-hidden="true" className="w-2.25 shrink-0" />
      )}
      <span className="grid min-w-0 gap-0.5 text-start">
        <span className="break-words text-sm text-foreground">
          {check.sentence}
        </span>
        <span className="text-xs text-muted-foreground">
          {pageCheckScopeLabel(t, check.scope)}
          <span aria-hidden="true"> · </span>
          {summary}
        </span>
      </span>
    </>
  );
  return (
    <li
      className="flex items-start gap-1 border-t border-border/70 py-2 first:border-t-0"
      data-page-check-row={check.id}
    >
      {shown.length > 0 ? (
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => actions.focusCheck(check.id)}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2">{content}</div>
      )}
      {skipped.length > 0 && !check.paused ? (
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground">
          {t("pageChecks.skippedCount", { count: skipped.length })}
          {actions.canEdit ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                for (const answer of skipped) {
                  if (!answer.place) continue;
                  void actions.skip({
                    checkId: check.id,
                    placeKey: answer.key,
                    textHash: answer.place.textHash,
                    undo: true,
                  });
                }
              }}
            >
              {t("pageChecks.undo")}
            </Button>
          ) : null}
        </span>
      ) : null}
      {actions.canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              aria-label={t("pageChecks.checkActions")}
            >
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => actions.openEdit(check.id)}>
              {t("pageChecks.editCheck")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void actions.setPaused(check.id, !check.paused)}
            >
              {check.paused ? t("pageChecks.resume") : t("pageChecks.pause")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => void actions.remove(check.id)}
            >
              {t("pageChecks.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

export function PageChecksPill() {
  const t = useT();
  const actions = usePageChecksActions();
  const state = usePageChecksState();
  if (!actions?.enabled || !state) return null;
  const count = pageChecksToLookAt(state.checks, state.live);
  if (count === 0) return null;
  const label = t("pageChecks.lookAt", { count });
  return (
    <button
      type="button"
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-warning-border bg-warning px-2.5 text-xs font-medium text-warning-foreground outline-none hover:brightness-[0.98] focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={label}
      title={label}
      onClick={actions.openList}
      data-page-checks-pill
    >
      <span aria-hidden="true" className="page-check-dot" data-shape="filled" />
      <span aria-hidden="true" className="tabular-nums sm:hidden">
        {count}
      </span>
      <span aria-hidden="true" className="max-sm:hidden">
        {label}
      </span>
    </button>
  );
}
