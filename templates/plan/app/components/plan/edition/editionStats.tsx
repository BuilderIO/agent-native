import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { ReactNode } from "react";

export type EditionStat =
  | { available: true; value: number }
  | { available: false };

/**
 * `null`/`undefined` on a stat means the number could not be resolved, which
 * is NOT zero. Rendering it as `0` turns a 74-PR day into a day where nothing
 * moved — the exact failure this surface exists to avoid — so every stat on
 * the page goes through here.
 */
export function editionStat(value: number | null | undefined): EditionStat {
  return typeof value === "number" && Number.isFinite(value)
    ? { available: true, value }
    : { available: false };
}

/** The one place the "no number available" glyph is spelled. */
export function EditionStatUnavailable({ label }: { label: string }) {
  return (
    <span title={label}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export type StatSum = {
  total: number;
  /** Rows that reported the stat, against rows that could have. */
  reported: number;
  counted: number;
};

export function sumStat(values: Array<number | null | undefined>): StatSum {
  let total = 0;
  let reported = 0;
  for (const value of values) {
    const stat = editionStat(value);
    if (!stat.available) continue;
    total += stat.value;
    reported += 1;
  }
  return { total, reported, counted: values.length };
}

/** A summed stat, or the unavailable glyph when nothing reported it. */
export function StatSumValue({ sum }: { sum: StatSum }) {
  const t = useT();
  const { formatNumber } = useFormatters();
  if (sum.reported === 0) {
    return <EditionStatUnavailable label={t("edition.promise.unavailable")} />;
  }
  return <>{formatNumber(sum.total)}</>;
}

/** `+62 −486`, with either half dropped when it did not resolve. */
export function useDiffText(
  rawAdditions: number | null | undefined,
  rawDeletions: number | null | undefined,
): ReactNode {
  const t = useT();
  const { formatNumber } = useFormatters();
  const additions = editionStat(rawAdditions);
  const deletions = editionStat(rawDeletions);
  const parts: string[] = [];
  if (additions.available) parts.push(`+${formatNumber(additions.value)}`);
  if (deletions.available) parts.push(`−${formatNumber(deletions.value)}`);
  if (parts.length === 0) {
    return (
      <EditionStatUnavailable label={t("edition.story.diffUnavailable")} />
    );
  }
  return <span className="tabular-nums">{parts.join(" ")}</span>;
}
