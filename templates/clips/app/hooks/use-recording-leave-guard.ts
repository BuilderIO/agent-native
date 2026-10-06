import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

/**
 * Ask the browser to confirm closing or reloading the tab while a recording
 * is live or its upload is not yet confirmed by the server.
 */
export function useUnsavedRecordingUnloadWarning(isUnsaved: () => boolean) {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!isUnsaved()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isUnsaved]);
}

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
