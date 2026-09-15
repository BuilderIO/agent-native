import { useCallback, useEffect, useRef } from "react";

export function useCommandPaletteFocus(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const returnFocusTargetRef = useRef<HTMLElement | null>(null);
  const returnFocusTargetIdRef = useRef<string | null>(null);
  const escapeDismissRef = useRef(false);

  const openPalette = useCallback(() => {
    if (open) return;

    const activeElement = document.activeElement;
    returnFocusTargetRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    returnFocusTargetIdRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement.id || null
        : null;
    escapeDismissRef.current = false;
    setOpen(true);
  }, [open, setOpen]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        openPalette();
        return;
      }

      setOpen(false);
      if (!escapeDismissRef.current) {
        returnFocusTargetRef.current = null;
        returnFocusTargetIdRef.current = null;
      }
    },
    [openPalette, setOpen],
  );

  const restoreFocusAfterEscape = useCallback((event: Event) => {
    const returnFocusTarget = returnFocusTargetRef.current;
    const returnFocusTargetId = returnFocusTargetIdRef.current;
    const shouldRestoreFocus = escapeDismissRef.current;
    escapeDismissRef.current = false;
    returnFocusTargetRef.current = null;
    returnFocusTargetIdRef.current = null;

    const focusTarget = returnFocusTarget?.isConnected
      ? returnFocusTarget
      : returnFocusTargetId
        ? document.getElementById(returnFocusTargetId)
        : null;
    if (!shouldRestoreFocus || !(focusTarget instanceof HTMLElement)) return;
    event.preventDefault();
    focusTarget.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;

    const markEscapeDismissal = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        escapeDismissRef.current = false;
        return;
      }

      const commandInput =
        document.querySelector<HTMLInputElement>("[cmdk-input]");
      escapeDismissRef.current = !commandInput?.value;
    };

    window.addEventListener("keydown", markEscapeDismissal, true);
    return () =>
      window.removeEventListener("keydown", markEscapeDismissal, true);
  }, [open]);

  return { openPalette, handleOpenChange, restoreFocusAfterEscape };
}
