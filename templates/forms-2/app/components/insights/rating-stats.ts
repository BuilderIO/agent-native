import type { Translate } from "@/lib/translate";

export type RatingEntry = { value: number; count: number };

export const RATING_VIEWS = [
  "average",
  "median",
  "bar",
  "pie",
  "nps",
  "csat",
] as const;
export type RatingView = (typeof RATING_VIEWS)[number];

export function ratingViewLabel(t: Translate, view: RatingView): string {
  switch (view) {
    case "average":
      return t("forms.insights.view.average");
    case "median":
      return t("forms.insights.view.median");
    case "bar":
      return t("forms.insights.view.bar");
    case "pie":
      return t("forms.insights.view.pie");
    case "nps":
      return t("forms.insights.view.nps");
    case "csat":
      return t("forms.insights.view.csat");
  }
}

function total(entries: RatingEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

export function median(entries: RatingEntry[]): number | null {
  const all = total(entries);
  if (all === 0) return null;
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const at = (rank: number) => {
    let seen = 0;
    for (const entry of sorted) {
      seen += entry.count;
      if (rank < seen) return entry.value;
    }
    return sorted[sorted.length - 1]?.value ?? 0;
  };
  return all % 2 === 1
    ? at((all - 1) / 2)
    : (at(all / 2 - 1) + at(all / 2)) / 2;
}

/** Share of answers at or above `min`, 0 to 100. */
function shareAtLeast(entries: RatingEntry[], min: number): number {
  const all = total(entries);
  if (all === 0) return 0;
  const hits = entries
    .filter((entry) => entry.value >= min)
    .reduce((sum, entry) => sum + entry.count, 0);
  return (hits / all) * 100;
}

/** Satisfied share: answers of 4 or more. */
export function csat(entries: RatingEntry[]): number {
  return shareAtLeast(entries, 4);
}

/** Promoters (5) minus detractors (3 or less), -100 to 100. */
export function nps(entries: RatingEntry[]): number {
  const promoters = shareAtLeast(entries, 5);
  const detractors = 100 - shareAtLeast(entries, 4);
  return promoters - detractors;
}

export function percent(count: number, all: number): number {
  return all === 0 ? 0 : Math.round((count / all) * 100);
}
