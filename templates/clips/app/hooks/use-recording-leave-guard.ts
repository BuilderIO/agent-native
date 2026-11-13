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
  const navigationAttemptRef = useRef(0);
  const blockedAttemptRef = useRef(0);
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) => {
        const attempt = ++navigationAttemptRef.current;
        const blocked =
          currentLocation.pathname !== nextLocation.pathname &&
          hasRecordingAtRisk();
        if (blocked) blockedAttemptRef.current = attempt;
        return blocked;
      },
      [hasRecordingAtRisk],
    ),
  );

  const getCurrentBlockers = useCallback(() => {
    if (!router)
      throw new Error("Recording leave guard requires a data router");
    return Array.from(router.state.blockers.values());
  }, [router]);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const confirmedBlockerRef = useRef<{
    blocker: Blocker;
    attempt: number;
  } | null>(null);
  const promptRef = useRef<{ blocker: Blocker | null; key: number }>({
    blocker: null,
    key: 0,
  });
  const mountedRef = useRef(false);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  if (blocker.state === "blocked" && promptRef.current.blocker !== blocker) {
    promptRef.current = { blocker, key: promptRef.current.key + 1 };
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      confirmedBlockerRef.current = null;
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setLeavePromptOpen(blocker.state === "blocked");
  }, [blocker]);

  const confirmLeave = useCallback(() => {
    if (blocker.state === "blocked" && getCurrentBlockers().includes(blocker)) {
      if (blockedAttemptRef.current === navigationAttemptRef.current) {
        confirmedBlockerRef.current = {
          blocker,
          attempt: blockedAttemptRef.current,
        };
      } else {
        blocker.reset();
      }
    }
    setLeavePromptOpen(false);
  }, [blocker, getCurrentBlockers]);

  const onDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setLeavePromptOpen(false);
      if (
        confirmedBlockerRef.current?.blocker !== blocker &&
        blocker.state === "blocked" &&
        getCurrentBlockers().includes(blocker)
      ) {
        blocker.reset();
      }
    },
    [blocker, getCurrentBlockers],
  );

  const onCloseAutoFocus = useCallback(
    (event: { preventDefault(): void }) => {
      if (!mountedRef.current) return;
      const currentBlockers = getCurrentBlockers();
      if (
        confirmedBlockerRef.current ||
        currentBlockers.some((current) => current.state === "blocked")
      ) {
        event.preventDefault();
      }
      const confirmed = confirmedBlockerRef.current;
      if (confirmed?.blocker !== blocker) return;
      confirmedBlockerRef.current = null;
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        if (
          blocker.state === "blocked" &&
          getCurrentBlockers().includes(blocker)
        ) {
          // A newer allowed navigation can load while this blocker stays in router state.
          if (navigationAttemptRef.current === confirmed.attempt) {
            blocker.proceed();
          } else {
            blocker.reset();
          }
        }
      }, 0);
      timersRef.current.add(timer);
    },
    [blocker, getCurrentBlockers],
  );

  return {
    leavePromptOpen,
    leavePromptKey: promptRef.current.key,
    onDialogOpenChange,
    onCloseAutoFocus,
    confirmLeave,
  };
}
