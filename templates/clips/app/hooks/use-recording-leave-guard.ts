import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

/**
 * Blocks in-app route navigation while `hasRecordingAtRisk()` is true, using
 * React Router's `useBlocker` — the same check the recorder's `beforeunload`
 * handler already uses for tab close/reload. Without this, an in-app link
 * (e.g. Library) unmounts the recorder route with no warning at all, since
 * the browser never fires `beforeunload` for client-side navigation.
 *
 * Exposes a tiny state machine for a confirm dialog rather than a boolean,
 * because confirming has to navigate away only after the dialog has actually
 * finished closing — see the `onCloseAutoFocus` deferral below.
 */
export function useRecordingLeaveGuard(hasRecordingAtRisk: () => boolean) {
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        currentLocation.pathname !== nextLocation.pathname &&
        hasRecordingAtRisk(),
      [hasRecordingAtRisk],
    ),
  );

  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  // See delete-recording-menu.tsx's `deletedWhileOpenRef`: navigating away
  // while Radix is still tearing down the AlertDialog portal can leave its
  // body pointer-events lock behind. Close the dialog first and defer
  // `blocker.proceed()` to `onCloseAutoFocus`, once Radix has actually
  // finished closing it, instead of calling it straight from the click
  // handler.
  const proceedBlockerRef = useRef<() => void>(() => {});
  proceedBlockerRef.current =
    blocker.state === "blocked" ? blocker.proceed : () => {};
  const leaveConfirmedRef = useRef(false);

  useEffect(() => {
    if (blocker.state === "blocked") setLeavePromptOpen(true);
  }, [blocker.state]);

  const confirmLeave = useCallback(() => {
    leaveConfirmedRef.current = true;
    setLeavePromptOpen(false);
  }, []);

  const onDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setLeavePromptOpen(false);
      if (!leaveConfirmedRef.current && blocker.state === "blocked") {
        blocker.reset();
      }
    },
    [blocker],
  );

  const onCloseAutoFocus = useCallback((event: { preventDefault(): void }) => {
    if (!leaveConfirmedRef.current) return;
    leaveConfirmedRef.current = false;
    event.preventDefault();
    setTimeout(() => proceedBlockerRef.current(), 0);
  }, []);

  return {
    leavePromptOpen,
    onDialogOpenChange,
    onCloseAutoFocus,
    confirmLeave,
  };
}
