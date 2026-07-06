import { IconInfoCircle } from "@tabler/icons-react";

/**
 * Slim, non-blocking banner shown below the canvas when the current user only
 * has viewer access to the design (Figma-style "you can't edit this" notice).
 * Purely informational — editing affordances are already disabled elsewhere
 * via `canEditDesign`; this just tells the viewer why.
 */
export function ReadOnlyDesignBanner() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center justify-center px-3 pb-2">
      <div className="flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-600 shadow-sm backdrop-blur-sm dark:text-blue-400">
        <IconInfoCircle className="size-3.5 shrink-0" />
        <span className="truncate">
          {
            "You don't have access to edit this design" /* i18n-ignore Figma-style read-only notice */
          }
        </span>
      </div>
    </div>
  );
}
