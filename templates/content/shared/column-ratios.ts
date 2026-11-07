/**
 * Column widths, as Notion-flavored Markdown writes them: each `<column>` may
 * carry `ratio`, its percentage of the row's width. A set either gives every
 * column a ratio or none, and none means equal widths.
 */

/** The narrowest a resize leaves a column, as a percentage of its row. */
export const MIN_COLUMN_RATIO = 10;

/** A written ratio as a number, or null when it isn't a usable percentage. */
export function parseColumnRatio(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= 100
      ? roundColumnRatio(value)
      : null;
  }
  if (typeof value !== "string" || !/^\s*\d+(?:\.\d+)?\s*%?\s*$/.test(value))
    return null;
  return parseColumnRatio(Number.parseFloat(value));
}

export function roundColumnRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How the attribute is written: `60`, `33.33`. */
export function formatColumnRatio(ratio: number): string {
  return String(roundColumnRatio(ratio));
}

/**
 * Every column's ratio once a set gives some of them one: a column without
 * one takes an equal part of what the others leave, or of the row when they
 * leave nothing, and then all of them are scaled to make 100. A set that gives
 * none stays without any.
 */
export function normalizeColumnRatios(
  ratios: readonly (number | null | undefined)[],
): (number | null)[] {
  const given = ratios.map((ratio) => parseColumnRatio(ratio));
  if (given.every((ratio) => ratio === null)) return given.map(() => null);
  const known = given.filter((ratio): ratio is number => ratio !== null);
  const missing = given.length - known.length;
  const knownTotal = known.reduce((sum, ratio) => sum + ratio, 0);
  const share =
    missing === 0
      ? 0
      : knownTotal < 100
        ? (100 - knownTotal) / missing
        : knownTotal / known.length;
  const filled = given.map((ratio) => ratio ?? share);
  const total = filled.reduce((sum, ratio) => sum + ratio, 0);
  if (Math.abs(total - 100) < 0.05) return filled.map(roundColumnRatio);
  return filled.map((ratio) => roundColumnRatio((ratio * 100) / total));
}

/** Each column's percentage of the row, as it is drawn. */
export function effectiveColumnRatios(
  ratios: readonly (number | null | undefined)[],
): number[] {
  const normalized = normalizeColumnRatios(ratios);
  return normalized.map((ratio) => ratio ?? 100 / Math.max(ratios.length, 1));
}

/**
 * The set's ratios after the seam right of column `index` moves so that that
 * column takes `leftShare` (0 to 1) of the two columns beside the seam. The
 * other columns keep their widths, and neither of the two goes below
 * `minRatio`.
 */
export function resizeColumnPair(
  ratios: readonly (number | null | undefined)[],
  index: number,
  leftShare: number,
  minRatio = MIN_COLUMN_RATIO,
): number[] {
  const current = effectiveColumnRatios(ratios);
  if (index < 0 || index + 1 >= current.length)
    return current.map(roundColumnRatio);
  const pair = current[index] + current[index + 1];
  const floor = Math.min(minRatio, pair / 2);
  const share = Number.isFinite(leftShare) ? leftShare : 0.5;
  const left = roundColumnRatio(
    Math.min(Math.max(pair * share, floor), pair - floor),
  );
  const next = current.map(roundColumnRatio);
  next[index] = left;
  next[index + 1] = roundColumnRatio(pair - left);
  return next;
}
