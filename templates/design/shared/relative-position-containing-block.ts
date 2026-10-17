type ElementWithParent<T> = {
  parentElement: T | null;
};

type DisplayDirectionStyle = Pick<CSSStyleDeclaration, "display" | "direction">;

export function relativePositionContainingBlockDirection<
  T extends ElementWithParent<T>,
>(
  element: T,
  getComputedStyle: (element: T) => DisplayDirectionStyle,
): "ltr" | "rtl" | undefined {
  let ancestor = element.parentElement;
  while (ancestor) {
    const styles = getComputedStyle(ancestor);
    const display = styles.display;
    if (display === "inline" || display === "contents") {
      ancestor = ancestor.parentElement;
      continue;
    }
    if (
      display === "block" ||
      display === "flow-root" ||
      display === "list-item" ||
      display === "inline-block" ||
      display === "flex" ||
      display === "inline-flex" ||
      display === "grid" ||
      display === "inline-grid" ||
      display === "table-cell" ||
      display === "table-caption"
    ) {
      return styles.direction === "ltr" || styles.direction === "rtl"
        ? styles.direction
        : undefined;
    }
    return undefined;
  }
  return undefined;
}
