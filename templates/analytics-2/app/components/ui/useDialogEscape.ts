import { useEffect } from "react";

import { useRestoreFocusOnUnmount } from "./useRestoreFocusOnUnmount";

/**
 * Escape dismisses a dialog, the way every dialog in the source closes through
 * the dialog's own onClose. The dialog is mounted only while it is open, so the
 * listener lives exactly as long as the dialog.
 */
export function useDialogEscape(onClose: () => void): void {
  useRestoreFocusOnUnmount();
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      onClose();
    }
    // Capture phase: a view-level shortcut handler that stops propagation on
    // Escape must not swallow the dialog's own dismissal.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
}
