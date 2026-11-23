import { useEffect, type RefObject } from "react";

import { useRestoreFocusOnUnmount } from "./useRestoreFocusOnUnmount";

/**
 * The behaviour every confirmation dialog in this app shares, taken from the
 * source's ConfirmationDialog: the confirm button takes focus when the dialog
 * opens, and Escape dismisses it through the same cancel path as the button.
 */
export function useConfirmDialogBehavior({
  onCancel,
  confirmRef,
}: {
  onCancel: () => void;
  confirmRef?: RefObject<HTMLButtonElement | null> | undefined;
}): void {
  useRestoreFocusOnUnmount();
  useEffect(() => {
    confirmRef?.current?.focus();
    // Focus once, on mount: the dialog is mounted only while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      onCancel();
    }
    // Capture phase: a view-level shortcut handler that stops propagation on
    // Escape must not swallow the dialog's own dismissal.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);
}
