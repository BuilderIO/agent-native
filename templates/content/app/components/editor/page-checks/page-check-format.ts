import type { useT } from "@agent-native/core/client/i18n";
import {
  isEachPageCheckScope,
  pageCheckCountDistance,
  pageCheckPartFinding,
  type PageCheck,
  type PageCheckCouldntReason,
  type PageCheckHeadingOp,
  type PageCheckOnlyWhere,
  type PageCheckPartResult,
  type PageCheckPlaceAnswer,
  type PageCheckScope,
  type PageCheckSure,
} from "@shared/page-checks";

type T = ReturnType<typeof useT>;
type CheckWording = Pick<PageCheck, "parts" | "sure">;

export function pageCheckScopeLabel(t: T, scope: PageCheckScope): string {
  switch (scope.kind) {
    case "page":
      return t("pageChecks.scopePage");
    case "intro":
      return t("pageChecks.scopeIntro");
    case "section":
      return t("pageChecks.scopeSection", { heading: scope.heading });
    case "each_section":
    case "each_paragraph": {
      const each = t(
        scope.kind === "each_section"
          ? "pageChecks.scopeEachSection"
          : "pageChecks.scopeEachParagraph",
      );
      return scope.only ? pageCheckOnlyWhereLabel(t, each, scope.only) : each;
    }
  }
}

export const PAGE_CHECK_OP_LABELS: Record<PageCheckHeadingOp, string> = {
  contains: "pageChecks.opContains",
  starts_with: "pageChecks.opStartsWith",
  is: "pageChecks.opIs",
};

function pageCheckOnlyWhereLabel(
  t: T,
  scope: string,
  only: PageCheckOnlyWhere,
): string {
  return only.field === "level"
    ? t("pageChecks.whereLevel", { scope, level: only.level })
    : t("pageChecks.whereHeading", {
        scope,
        op: t(PAGE_CHECK_OP_LABELS[only.op]),
        text: only.text,
      });
}

export function isEachPageCheck(check: Pick<PageCheck, "scope">): boolean {
  return isEachPageCheckScope(check.scope);
}

export function pageCheckMissText(
  t: T,
  check: CheckWording,
  results: readonly PageCheckPartResult[],
): string {
  return results
    .flatMap((result, index) => {
      const part = check.parts.find((_, at) => at === index);
      if (!part || pageCheckPartFinding(result, check.sure) !== "not_fine")
        return [];
      if (part.kind === "question") {
        return [t("pageChecks.doesntPass", { part: part.text })];
      }
      if (result.count === undefined) return [];
      const count = t(`pageChecks.${part.unit}`, { count: result.count });
      const distance = pageCheckCountDistance(part, result.count);
      return [
        t("pageChecks.countAndDistance", {
          count,
          distance: t(distance > 0 ? "pageChecks.over" : "pageChecks.short", {
            count: Math.abs(distance),
          }),
        }),
      ];
    })
    .join(" · ");
}

export const PAGE_CHECK_SURE_LABELS: Record<PageCheckSure, string> = {
  sure: "pageChecks.sureSure",
  balanced: "pageChecks.sureBalanced",
  more: "pageChecks.sureMore",
};

const COULDNT_TEXT: Record<PageCheckCouldntReason, string> = {
  section_deleted: "pageChecks.sectionDeleted",
  no_model: "pageChecks.couldntNoModel",
  model_failed: "pageChecks.couldntModelFailed",
  daily_limit: "pageChecks.couldntDailyLimit",
};

export function pageCheckCouldntText(
  t: T,
  reason: PageCheckCouldntReason | undefined,
): string {
  return reason ? t(COULDNT_TEXT[reason]) : t("pageChecks.couldnt");
}

export function pageCheckAnswerText(
  t: T,
  check: CheckWording,
  answer: Pick<PageCheckPlaceAnswer, "answer" | "result" | "reason">,
): string {
  switch (answer.answer) {
    case "fine":
      return t("pageChecks.fine");
    case "not_fine":
      return (
        (answer.result && pageCheckMissText(t, check, answer.result.parts)) ||
        t("pageChecks.notFine")
      );
    case "skipped":
      return t("pageChecks.skipped");
    case "changed":
      return t("pageChecks.changed");
    case "couldnt":
      return pageCheckCouldntText(
        t,
        answer.reason ??
          answer.result?.parts.find((part) => part.reason !== undefined)
            ?.reason,
      );
  }
}

export function pageCheckSummaryText(
  t: T,
  check: CheckWording,
  answers: readonly Pick<
    PageCheckPlaceAnswer,
    "answer" | "result" | "reason" | "place"
  >[],
  each: boolean,
): string {
  if (!each) {
    return answers[0]
      ? pageCheckAnswerText(t, check, answers[0])
      : t("pageChecks.nothingMatches");
  }
  if (answers.length === 0) return t("pageChecks.nothingMatches");
  const counted = answers.filter((answer) => answer.answer !== "skipped");
  const missing = counted.filter((answer) => answer.answer === "not_fine");
  if (missing.length > 0) {
    return t("pageChecks.ofTotal", {
      missing: missing.length,
      total: counted.length,
    });
  }
  const unsure =
    counted.find((answer) => answer.answer === "couldnt") ??
    counted.find((answer) => answer.answer === "changed");
  return unsure ? pageCheckAnswerText(t, check, unsure) : t("pageChecks.fine");
}
