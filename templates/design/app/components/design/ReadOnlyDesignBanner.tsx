import { useT } from "@agent-native/core/client";
import { IconInfoCircle, IconMessage } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Slim, non-blocking banner shown below the canvas when the current user only
 * has viewer access to the design (Figma-style "you can't edit this" notice).
 * Editing affordances are disabled elsewhere via `canEditDesign`; signed-in
 * viewers get their one canvas action integrated into the same quiet notice.
 */
export function ReadOnlyDesignBanner({
  pinMode = false,
  onCommentPin,
}: {
  pinMode?: boolean;
  onCommentPin?: () => void;
}) {
  const t = useT();
  const commentLabel = pinMode
    ? t("designEditor.stopPinningComments")
    : t("designEditor.pinComment");

  return (
    <div
      data-read-only-design-banner
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[50] flex items-center justify-center px-3 pb-2"
    >
      <div className="flex max-w-full items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 py-1 pe-1 ps-3 text-xs text-blue-600 shadow-sm backdrop-blur-sm dark:text-blue-400">
        <IconInfoCircle className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {
            "You don't have access to edit this design" /* i18n-ignore Figma-style read-only notice */
          }
        </span>
        {onCommentPin ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "pointer-events-auto size-7 shrink-0 rounded-full text-blue-600 hover:bg-blue-500/15 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
                  pinMode &&
                    "bg-blue-500/20 text-blue-700 dark:bg-blue-400/20 dark:text-blue-300",
                )}
                aria-label={commentLabel}
                aria-pressed={pinMode}
                onClick={onCommentPin}
              >
                <IconMessage className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{commentLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
