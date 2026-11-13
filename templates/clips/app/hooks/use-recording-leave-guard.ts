import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  UNSAFE_DataRouterContext,
  useBlocker,
  type Blocker,
} from "react-router";

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
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        currentLocation.pathname !== nextLocation.pathname &&
        hasRecordingAtRisk(),
      [hasRecordingAtRisk],
    ),
  );

  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const confirmedBlockerRef = useRef<Blocker | null>(null);

  useEffect(() => {
    setLeavePromptOpen(blocker.state === "blocked");
  }, [blocker]);

  const confirmLeave = useCallback(() => {
    confirmedBlockerRef.current = blocker.state === "blocked" ? blocker : null;
    setLeavePromptOpen(false);
  }, [blocker]);

  const onDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setLeavePromptOpen(false);
      if (
        !confirmedBlockerRef.current &&
        blocker.state === "blocked" &&
        Array.from(router?.state.blockers.values() ?? []).includes(blocker)
      ) {
        blocker.reset();
      }
    },
    [blocker, router],
  );

  const onCloseAutoFocus = useCallback(
    (event: { preventDefault(): void }) => {
      const confirmedBlocker = confirmedBlockerRef.current;
      if (!confirmedBlocker) return;
      confirmedBlockerRef.current = null;
      event.preventDefault();
      setTimeout(() => {
        // Router state can change before React renders, including to a different blocked navigation.
        if (
          confirmedBlocker.state === "blocked" &&
          Array.from(router?.state.blockers.values() ?? []).includes(
            confirmedBlocker,
          )
        ) {
          confirmedBlocker.proceed();
        }
      }, 0);
    },
    [router],
  );

  return {
    leavePromptOpen,
    onDialogOpenChange,
    onCloseAutoFocus,
    confirmLeave,
  };
}
