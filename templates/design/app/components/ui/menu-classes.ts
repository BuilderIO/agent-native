export const designMenuContentClass = "rounded-[6px] p-1";

const designMenuHighlightClass = [
  "transition-none",
  "focus:bg-[var(--design-brand)] focus:text-[var(--design-brand-foreground)]",
  "data-[highlighted]:bg-[var(--design-brand)] data-[highlighted]:text-[var(--design-brand-foreground)]",
  "data-[highlighted]:[&_.text-muted-foreground]:text-[var(--design-brand-foreground)]/80",
].join(" ");

export const designMenuItemClass = [
  "min-h-[var(--design-control-height)] gap-2 rounded-[3px] px-2 py-1 text-xs leading-4",
  designMenuHighlightClass,
].join(" ");

export const designMenuInsetClass = "ps-8";

export const designMenuIndicatorItemClass = [
  "ps-8 pe-2",
  "[&>span:first-child]:start-2 [&>span:first-child]:text-[var(--design-brand-ink)]",
  "data-[highlighted]:[&>span:first-child]:text-[var(--design-brand-foreground)]",
].join(" ");

export const designMenuSubTriggerClass = [
  "data-[state=open]:bg-[var(--design-brand)] data-[state=open]:text-[var(--design-brand-foreground)]",
  "data-[state=open]:[&_.text-muted-foreground]:text-[var(--design-brand-foreground)]/80",
].join(" ");

export const designMenuDestructiveClass =
  "text-[var(--design-destructive)] [&_svg]:text-[var(--design-destructive)] data-[highlighted]:[&_svg]:text-[var(--design-brand-foreground)]";

export const designMenuLabelClass =
  "design-font-medium flex min-h-[var(--design-control-height)] items-center px-2 py-1 text-[11px] leading-4 font-normal";

export const designMenuShortcutClass = "text-[11px] leading-4";

export type DesignMenuItemVariant = "default" | "destructive";
