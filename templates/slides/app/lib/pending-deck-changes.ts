import { useEffect } from "react";

export function preventPendingDeckUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = "";
}

/**
 * Keep the browser's native reload/close confirmation attached only while a
 * deck has local work that cannot be recovered from the server.
 */
export function usePendingDeckUnloadGuard(hasPendingEdits: boolean): void {
  useEffect(() => {
    if (!hasPendingEdits) return;
    window.addEventListener("beforeunload", preventPendingDeckUnload, {
      capture: true,
    });
    return () => {
      window.removeEventListener("beforeunload", preventPendingDeckUnload, {
        capture: true,
      });
    };
  }, [hasPendingEdits]);
}

export function shouldBlockPendingDeckNavigation(args: {
  hasPendingEdits: boolean;
  currentPathname: string;
  nextPathname: string;
}): boolean {
  return args.hasPendingEdits && args.currentPathname !== args.nextPathname;
}
