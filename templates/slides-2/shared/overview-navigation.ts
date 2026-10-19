export function overviewFocusNavigationIndex(
  focusedIndex: number,
  slideCount: number,
  key: string,
  columns: number,
): number | null {
  if (
    !Number.isInteger(focusedIndex) ||
    !Number.isInteger(slideCount) ||
    !Number.isInteger(columns) ||
    focusedIndex < 0 ||
    focusedIndex >= slideCount ||
    columns < 1
  ) {
    return null;
  }

  if (key === "Home") return 0;
  if (key === "End") return slideCount - 1;

  const offset =
    key === "ArrowRight"
      ? 1
      : key === "ArrowLeft"
        ? -1
        : key === "ArrowDown"
          ? columns
          : key === "ArrowUp"
            ? -columns
            : null;
  if (offset === null) return null;

  return Math.max(0, Math.min(slideCount - 1, focusedIndex + offset));
}
