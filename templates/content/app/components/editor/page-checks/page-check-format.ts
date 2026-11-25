import type { useT } from "@agent-native/core/client/i18n";
import {
  pageCheckCountDistance,
  type PageCheckPart,
  type PageCheckPartResult,
  type PageCheckPlaceAnswer,
  type PageCheckScope,
} from "@shared/page-checks";

type T = ReturnType<typeof useT>;

export function pageCheckScopeLabel(t: T, scope: PageCheckScope): string {
  switch (scope.kind) {
    case "page":
      return t("pageChecks.scopePage");
    case "intro":
      return t("pageChecks.scopeIntro");
    case "section":
      return t("pageChecks.scopeSection", { heading: scope.heading });
    case "each_paragraph":
      return t("pageChecks.scopeEachParagraph");
  }
}

export function pageCheckMissText(
  t: T,
  parts: readonly PageCheckPart[],
  results: readonly PageCheckPartResult[],
): string {
  return results
    .flatMap((result, index) => {
      const part = parts.at(index);
      if (!part || result.finding !== "not_fine" || result.count === undefined)
        return [];
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

export function pageCheckAnswerText(
  t: T,
  parts: readonly PageCheckPart[],
  answer: Pick<PageCheckPlaceAnswer, "answer" | "result" | "reason">,
): string {
  switch (answer.answer) {
    case "fine":
      return t("pageChecks.fine");
    case "not_fine":
      return (
        (answer.result && pageCheckMissText(t, parts, answer.result.parts)) ||
        t("pageChecks.notFine")
      );
    case "skipped":
      return t("pageChecks.skipped");
    case "changed":
      return t("pageChecks.changed");
    case "couldnt":
      return answer.reason === "section_deleted"
        ? t("pageChecks.sectionDeleted")
        : t("pageChecks.couldnt");
  }
}

export function pageCheckSummaryText(
  t: T,
  parts: readonly PageCheckPart[],
  answers: readonly Pick<
    PageCheckPlaceAnswer,
    "answer" | "result" | "reason" | "place"
  >[],
  each: boolean,
): string {
  if (!each) {
    return answers[0]
      ? pageCheckAnswerText(t, parts, answers[0])
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
  return unsure ? pageCheckAnswerText(t, parts, unsure) : t("pageChecks.fine");
}
