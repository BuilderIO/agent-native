import { Button } from "@agent-native/toolkit/ui/button";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { cn } from "@agent-native/toolkit/utils";
import { IconCircleCheck, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface ReviewThreadCardFrameProps {
  title?: string | undefined;
  /** Set false to render the card body without the title bar. */
  showTitleBar?: boolean | undefined;
  /** Usually a `ReviewThreadMenu`; rendered first in the title bar. */
  menu?: ReactNode;
  resolved?: boolean | undefined;
  /** The Resolve button shows only when this is set and the thread is open. */
  onResolve?: (() => void) | undefined;
  /** The Reopen button shows only when this is set and the thread is resolved. */
  onReopen?: (() => void) | undefined;
  resolving?: boolean | undefined;
  onClose?: (() => void) | undefined;
  resolveLabel?: string | undefined;
  reopenLabel?: string | undefined;
  closeLabel?: string | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

const ICON_BUTTON_CLASS =
  "size-7 shrink-0 rounded-[8px] text-foreground [&_svg]:size-4";

export function ReviewThreadCardFrame({
  title = "Comment",
  showTitleBar = true,
  menu,
  resolved = false,
  onResolve,
  onReopen,
  resolving = false,
  onClose,
  resolveLabel = "Resolve",
  reopenLabel = "Reopen",
  closeLabel = "Close",
  className,
  children,
}: ReviewThreadCardFrameProps) {
  const toggleResolution = resolved ? onReopen : onResolve;
  return (
    <div
      className={cn(
        "@container/review flex w-[360px] max-w-full flex-col overflow-clip rounded-xl border border-border bg-popover text-popover-foreground shadow-lg",
        className,
      )}
      data-review-thread-card
    >
      {showTitleBar ? (
        <div className="flex h-[42px] shrink-0 items-center justify-between border-b border-border pe-2 ps-3">
          <span className="min-w-0 truncate text-xs font-semibold text-foreground">
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {menu}
            {toggleResolution ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ICON_BUTTON_CLASS}
                disabled={resolving}
                aria-label={resolved ? reopenLabel : resolveLabel}
                onClick={toggleResolution}
              >
                {resolving ? <Spinner /> : <IconCircleCheck />}
              </Button>
            ) : null}
            {onClose ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={ICON_BUTTON_CLASS}
                aria-label={closeLabel}
                onClick={onClose}
              >
                <IconX />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}
