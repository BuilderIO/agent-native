import { useEffect } from "react";

export function preventPendingLiveEditUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = "";
}

/**
 * Pending localhost edits live in the iframe preview and its in-memory
 * undo/redo stacks. A hard reload cannot restore that complete session safely,
 * so keep the native browser confirmation attached only while those edits
 * exist. Clearing the pending state after Apply or explicit discard removes
 * the listener on the next render.
 */
export function usePendingLiveEditUnloadGuard(hasPendingEdits: boolean): void {
  useEffect(() => {
    if (!hasPendingEdits) return;
    window.addEventListener("beforeunload", preventPendingLiveEditUnload, {
      capture: true,
    });
    return () => {
      window.removeEventListener("beforeunload", preventPendingLiveEditUnload, {
        capture: true,
      });
    };
  }, [hasPendingEdits]);
}
