export const menuIconClass = "size-4 shrink-0 text-muted-foreground";

// Escape should close a menu within a frame; the shared close animation
// alone takes 100 ms. Its `animate-out` outranks a plain `animate-none`.
export const instantCloseMenuClass = "data-[state=closed]:!animate-none";

export const menuSurfaceClass =
  "rounded-[10px] border border-border bg-popover p-1 text-popover-foreground shadow-md";
export const menuRowClass =
  "relative flex w-full cursor-pointer select-none items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-start text-sm outline-none transition-colors";
export const menuRowHighlightClass = "bg-accent text-accent-foreground";
export const menuLabelClass =
  "px-1.5 py-1 text-xs font-medium text-muted-foreground";
export const menuSeparatorClass = "-mx-1 my-1 h-px bg-border";
export const menuShortcutClass =
  "ms-auto inline-flex min-w-4 shrink-0 justify-center text-xs tabular-nums text-muted-foreground";

export const menuSearchInputClass =
  "h-6 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground";
