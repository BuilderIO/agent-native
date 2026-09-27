import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

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
