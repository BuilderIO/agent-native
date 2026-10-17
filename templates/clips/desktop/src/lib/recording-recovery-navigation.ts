import { useLayoutEffect, useRef, type RefObject } from "react";

export function shouldDismissDesktopPopover(event: KeyboardEvent) {
  return (
    event.key === "Escape" &&
    !event.defaultPrevented &&
    !document.querySelector(
      '[data-radix-popper-content-wrapper] [data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    )
  );
}

export function useRecordingRecoveryNavigation<View extends string>(
  view: View | "recovery",
  setView: (view: View | "recovery") => void,
  rootRef: RefObject<HTMLElement | null>,
) {
  const origin = useRef<View | "recovery">(view);
  const restoreFocus = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (view === "recovery" || !restoreFocus.current) return;
    restoreFocus.current = false;
    const target =
      triggerRef.current ??
      rootRef.current?.querySelector<HTMLElement>(
        "[data-recovery-focus-fallback]",
      ) ??
      rootRef.current?.querySelector<HTMLElement>("button:not(:disabled)");
    target?.focus();
  }, [view, rootRef]);

  return {
    triggerRef,
    openRecovery: () => {
      if (view === "recovery") return;
      origin.current = view;
      setView("recovery");
    },
    closeRecovery: () => {
      restoreFocus.current = true;
      setView(origin.current);
    },
  };
}
