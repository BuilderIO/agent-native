import { IconLock } from "@tabler/icons-react";

/**
 * Slim, non-blocking banner shown above the canvas when the current user only
 * has viewer access to the design (Figma-style "you can't edit this" notice).
 * Purely informational — editing affordances are already disabled elsewhere
 * via `canEditDesign`; this just tells the viewer why.
 */
export function ReadOnlyDesignBanner() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-center px-3 pt-2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border/60 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
        <IconLock className="size-3.5 shrink-0" />
        <span className="truncate">
          {
            "You don't have access to edit this design" /* i18n-ignore Figma-style read-only notice */
          }
        </span>
      </div>
    </div>
  );
}
