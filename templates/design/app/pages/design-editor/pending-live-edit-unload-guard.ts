import { useEffect } from "react";

export function preventPendingLiveEditUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = "";
}

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
