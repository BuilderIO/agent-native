// Design's menu spec (ENG-14561), shared by the dropdown and context menu
// adapters: 4px content padding, 24px rows, 12px text, 11px group labels and a
// solid brand highlight with white text. These classes are merged after the
// toolkit's own, so they win every conflict through tailwind-merge.

export const designMenuContentClass = "rounded-[6px] p-1";

/** Highlight for keyboard focus and pointer hover (Radix focuses on hover). */
const designMenuHighlightClass = [
  "focus:bg-[var(--design-brand)] focus:text-[var(--design-brand-foreground)]",
  "data-[highlighted]:bg-[var(--design-brand)] data-[highlighted]:text-[var(--design-brand-foreground)]",
  // Muted text inside a row (shortcuts, descriptions, icons) stays readable on the fill.
  "data-[highlighted]:[&_.text-muted-foreground]:text-[var(--design-brand-foreground)]/80",
].join(" ");

/** One line is 24px tall; a row with a description grows instead of clipping. */
export const designMenuItemClass = [
  "min-h-[var(--design-control-height)] gap-2 rounded-[3px] px-2 py-1 text-xs leading-4",
  designMenuHighlightClass,
].join(" ");

/** Inset rows line their text up with rows that carry a check. */
export const designMenuInsetClass = "ps-8";

/** Check and radio rows: 8px inset, 16px check slot, 8px gap, then the label. */
export const designMenuIndicatorItemClass = [
  "ps-8 pe-2",
  "[&>span:first-child]:start-2 [&>span:first-child]:text-[var(--design-brand-ink)]",
  "data-[highlighted]:[&>span:first-child]:text-[var(--design-brand-foreground)]",
].join(" ");

export const designMenuSubTriggerClass = [
  "data-[state=open]:bg-[var(--design-brand)] data-[state=open]:text-[var(--design-brand-foreground)]",
  "data-[state=open]:[&_.text-muted-foreground]:text-[var(--design-brand-foreground)]/80",
].join(" ");

/** Destructive rows keep the destructive color at rest and read white on the fill. */
export const designMenuDestructiveClass =
  "text-[var(--design-destructive)] [&_svg]:text-[var(--design-destructive)] data-[highlighted]:[&_svg]:text-[var(--design-brand-foreground)]";

export const designMenuLabelClass =
  "design-font-medium flex min-h-[var(--design-control-height)] items-center px-2 py-1 text-[11px] leading-4 font-normal";

export const designMenuShortcutClass = "text-[11px] leading-4";

export type DesignMenuItemVariant = "default" | "destructive";
