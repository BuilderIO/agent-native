import { useLayoutEffect, useRef, type RefObject } from "react";

const COLUMN_GLIDE_MS = 160;
const COLUMN_GLIDE_EASING = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * Remembers where each column of a table starts and, when a later layout
 * moves a column (a streamed cell grew the one before it), slides that
 * column's cells from the old position to the new one instead of jumping.
 * Call the returned function after every layout of the table.
 */
export function createTableColumnGlide(): (table: HTMLTableElement) => void {
  let previous: number[] = [];
  return (table) => {
    const firstRow = table.rows.item(0);
    if (!firstRow) {
      previous = [];
      return;
    }
    const starts = Array.from(firstRow.cells, (cell) => cell.offsetLeft);
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && typeof Element.prototype.animate === "function") {
      starts.forEach((start, column) => {
        const before = previous.at(column);
        if (before === undefined) return;
        const shift = start - before;
        if (Math.abs(shift) < 1) return;
        for (const row of table.rows) {
          // Additive, so a column that moves again mid-glide carries on from
          // where it is instead of restarting.
          row.cells
            .item(column)
            ?.animate(
              [
                { transform: `translateX(${-shift}px)` },
                { transform: "translateX(0)" },
              ],
              {
                duration: COLUMN_GLIDE_MS,
                easing: COLUMN_GLIDE_EASING,
                composite: "add",
              },
            );
        }
      });
    }
    previous = starts;
  };
}

/** Longer than a label, a number or a date: text that should wrap. */
const TABLE_PROSE_CELL_MIN_CHARACTERS = 32;

/**
 * Marks cells holding prose with `data-prose`, so the stylesheet lets them
 * wrap at a readable minimum width while short cells keep to one line. CSS
 * alone cannot tell a sentence from a label.
 */
export function markTableProseCells(table: HTMLTableElement): void {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      const prose =
        cell.textContent.trim().length >= TABLE_PROSE_CELL_MIN_CHARACTERS;
      if (prose !== cell.hasAttribute("data-prose")) {
        cell.toggleAttribute("data-prose", prose);
      }
    }
  }
}

/**
 * Sizes `table`'s cells for wrapping and glides its columns whenever a render
 * moves them. Cells are marked first, because marking changes the widths the
 * glide measures.
 */
export function useTableColumnGlide(
  table: RefObject<HTMLTableElement | null>,
): void {
  const glide = useRef<((table: HTMLTableElement) => void) | null>(null);
  useLayoutEffect(() => {
    if (!table.current) return;
    markTableProseCells(table.current);
    glide.current ??= createTableColumnGlide();
    glide.current(table.current);
  });
}
