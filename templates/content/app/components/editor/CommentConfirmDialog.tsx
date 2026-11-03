import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const buttonFocusRing =
  "focus-visible:ring-1 focus-visible:ring-muted-foreground/40 focus-visible:ring-offset-1";

/**
 * What a comment asks before something is lost: a draft or an edit
 * discarded, or a comment deleted. The confirm button takes focus, so Enter
 * confirms and Escape keeps things as they were.
 */
export function CommentConfirmDialog({
  open,
  onCancel,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  busy = false,
  onClosed,
}: {
  open: boolean;
  /** Escape, a click outside, or the cancel button; not while busy. */
  onCancel: () => void;
  title: ReactNode;
  description: ReactNode;
  cancelLabel: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  busy?: boolean;
  /** Puts focus back where it belongs once the dialog has closed. */
  onClosed: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Until focus is back it counts as an open control, so a comment row keeps
  // its hover-only actions showing and focus can return to their menu.
  const [returningFocus, setReturningFocus] = useState(false);
  return (
    // The dialog renders in a portal, but React still bubbles its events
    // through this tree, where a thread card would read them as its own.
    <span
      className="contents"
      data-state={open || returningFocus ? "open" : "closed"}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* Dialog, not AlertDialog: AlertDialog bundles its own focus trap,
          which the mobile Comments Sheet's trap would fight. It takes
          AlertDialog's layer instead, above a Collection cell's card. */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) onCancel();
        }}
      >
        <DialogContent
          role="alertdialog"
          hideClose
          overlayClassName="z-[340]"
          className="z-[350] max-w-sm gap-0 rounded-lg p-5"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            setReturningFocus(true);
            confirmRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed();
            setReturningFocus(false);
          }}
        >
          <DialogHeader className="space-y-0 gap-1.5 text-start">
            <DialogTitle className="text-base leading-tight tracking-tight">
              {title}
            </DialogTitle>
            <DialogDescription className="leading-normal [text-wrap:pretty]">
              {description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-row items-center justify-end gap-2 sm:space-x-0">
            <DialogClose asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className={buttonFocusRing}
              >
                {cancelLabel}
              </Button>
            </DialogClose>
            <Button
              ref={confirmRef}
              variant="destructive"
              size="sm"
              disabled={busy}
              className={buttonFocusRing}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
