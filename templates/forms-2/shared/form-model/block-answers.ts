import type { MatrixAnswer } from "./types.js";

/**
 * Click on a ranking option: ranks it last, or unranks it. When one option is
 * left unranked it takes the last rank by itself.
 */
export function toggleRank(
  ranked: readonly string[],
  allIds: readonly string[],
  id: string,
): string[] {
  if (ranked.includes(id)) return ranked.filter((other) => other !== id);
  const next = [...ranked, id];
  const remaining = allIds.filter((other) => !next.includes(other));
  const [last] = remaining;
  return remaining.length === 1 && last ? [...next, last] : next;
}

/** Moves a ranked option up (-1) or down (1) one rank. */
export function moveRank(
  ranked: readonly string[],
  id: string,
  delta: -1 | 1,
): string[] {
  const from = ranked.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ranked.length) return [...ranked];
  const next = [...ranked];
  next[from] = ranked[to] ?? id;
  next[to] = id;
  return next;
}

/** Drag-and-drop: puts ranked option `id` at the rank of `targetId`. */
export function moveRankTo(
  ranked: readonly string[],
  id: string,
  targetId: string,
): string[] {
  const to = ranked.indexOf(targetId);
  if (id === targetId || to < 0 || !ranked.includes(id)) return [...ranked];
  const next = ranked.filter((other) => other !== id);
  next.splice(to, 0, id);
  return next;
}

/** Picks a matrix cell: replaces the row's pick, or toggles it when `multiple`. */
export function pickMatrixCell(
  answer: MatrixAnswer | null,
  rowId: string,
  columnId: string,
  multiple: boolean,
): MatrixAnswer {
  const matrix = { ...answer?.matrix };
  const current = matrix[rowId] ?? [];
  if (!multiple) matrix[rowId] = [columnId];
  else
    matrix[rowId] = current.includes(columnId)
      ? current.filter((id) => id !== columnId)
      : [...current, columnId];
  return { matrix };
}
