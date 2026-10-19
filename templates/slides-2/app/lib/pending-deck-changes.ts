import { useEffect } from "react";

export function preventPendingDeckUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = "";
}

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
  allowPendingEdits?: boolean;
}): boolean {
  return (
    args.hasPendingEdits &&
    !args.allowPendingEdits &&
    args.currentPathname !== args.nextPathname
  );
}
