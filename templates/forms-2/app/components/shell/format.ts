import type { FormSummary } from "@shared/form-contract";

import type { Translate } from "@/lib/translate";

/** Compact age for rows: "now", "5m", "2h", "3d", "4w", "6mo", "2y". */
export function relativeTime(
  iso: string,
  t: Translate,
  now: number = Date.now(),
): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return t("forms.shell.timeNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("forms.shell.timeMinutes", { value: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("forms.shell.timeHours", { value: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("forms.shell.timeDays", { value: days });
  if (days < 30)
    return t("forms.shell.timeWeeks", { value: Math.floor(days / 7) });
  if (days < 365)
    return t("forms.shell.timeMonths", { value: Math.floor(days / 30) });
  return t("forms.shell.timeYears", { value: Math.floor(days / 365) });
}

export function formDisplayName(
  form: Pick<FormSummary, "name">,
  t: Translate,
): string {
  return form.name.trim() || t("forms.common.untitled");
}

/** The muted text at the right of a form row, without the age. */
export function formActivity(
  form: Pick<FormSummary, "status" | "submissionCount">,
  t: Translate,
): { text: string; isDraft: boolean } {
  if (form.status === "draft")
    return { text: t("forms.shell.activityDraft"), isDraft: true };
  if (form.status === "blank") return { text: "", isDraft: false };
  if (form.submissionCount === 0)
    return {
      text: t("forms.shell.activityNoSubmissions"),
      isDraft: false,
    };
  return {
    text: t("forms.shell.submissionCount", { count: form.submissionCount }),
    isDraft: false,
  };
}

/** Server-side substring search runs only for a non-empty trimmed query. */
export function formSearchQuery(search: string): string | null {
  const trimmed = search.trim();
  return trimmed ? trimmed : null;
}
