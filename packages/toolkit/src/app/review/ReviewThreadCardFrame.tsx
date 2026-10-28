import { Button } from "@agent-native/toolkit/ui/button";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { cn } from "@agent-native/toolkit/utils";
import { IconCircleCheck, IconX } from "@tabler/icons-react";
import { forwardRef, useId, type ReactNode } from "react";

export interface ReviewThreadCardFrameProps {
  title?: string | undefined;
  /** Set false to render the card body without the title bar. */
  showTitleBar?: boolean | undefined;
  /** Names the dialog when `showTitleBar` is false and there is no title to point at. */
  ariaLabel?: string | undefined;
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

/**
 * A non-modal dialog. It takes programmatic focus (`tabIndex={-1}`) so a host
 * can move focus to the card when it opens; the ref is the focus target.
 */
export const ReviewThreadCardFrame = forwardRef<
  HTMLDivElement,
  ReviewThreadCardFrameProps
>(function ReviewThreadCardFrame(
  {
    title = "Comment",
    showTitleBar = true,
    ariaLabel,
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
  },
  ref,
) {
  const titleId = useId();
  const toggleResolution = resolved ? onReopen : onResolve;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={showTitleBar ? titleId : undefined}
      aria-label={showTitleBar ? undefined : ariaLabel}
      tabIndex={-1}
      className={cn(
        "@container/review flex w-[360px] max-w-full flex-col overflow-clip rounded-xl border border-border bg-popover text-popover-foreground shadow-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      data-review-thread-card
    >
      {showTitleBar ? (
        <div className="flex h-[42px] shrink-0 items-center justify-between border-b border-border pe-2 ps-3">
          <span
            id={titleId}
            className="min-w-0 truncate text-xs font-semibold text-foreground"
          >
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
});
