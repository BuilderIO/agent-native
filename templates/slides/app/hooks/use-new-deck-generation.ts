import { useEffect, useRef, useState } from "react";

import {
  NEW_DECK_GENERATION_START_TIMEOUT_MS,
  nextNewDeckGenerationPhase,
  type NewDeckGenerationPhase,
} from "@/lib/generation-state";

import { CHAT_STOP_DEBOUNCE_MS } from "./use-agent-generating";

type NewDeckGenerationLifecycle = {
  deckId: string;
  isNewDeckCreation: boolean;
  isNewDeckRoute: boolean;
  phase: NewDeckGenerationPhase;
};

export function useNewDeckGeneration({
  deckId,
  isNewDeckRoute,
  generating,
  waitingOnQuestions,
}: {
  deckId: string;
  isNewDeckRoute: boolean;
  generating: boolean;
  waitingOnQuestions: boolean;
}) {
  const [lifecycle, setLifecycle] = useState<NewDeckGenerationLifecycle>(() =>
    createLifecycle(deckId, isNewDeckRoute),
  );
  const isDeckChanged = lifecycle.deckId !== deckId;
  const isNewGenerationRoute = isNewDeckRoute && !lifecycle.isNewDeckRoute;
  let currentLifecycle = lifecycle;

  if (isDeckChanged || isNewGenerationRoute) {
    currentLifecycle = createLifecycle(deckId, isNewDeckRoute);
    setLifecycle(currentLifecycle);
  } else if (lifecycle.isNewDeckRoute !== isNewDeckRoute) {
    currentLifecycle = { ...lifecycle, isNewDeckRoute };
    setLifecycle(currentLifecycle);
  }

  useEffect(() => {
    if (!currentLifecycle.isNewDeckCreation) return;

    const nextPhase = nextNewDeckGenerationPhase({
      phase: currentLifecycle.phase,
      generating,
      waitingOnQuestions,
      waitExpired: false,
    });
    if (nextPhase !== currentLifecycle.phase) {
      setLifecycle((current) =>
        current.deckId === deckId ? { ...current, phase: nextPhase } : current,
      );
    }

    if (
      generating ||
      waitingOnQuestions ||
      currentLifecycle.phase !== "pending"
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setLifecycle((current) => {
        if (current.deckId !== deckId || current.phase !== "pending") {
          return current;
        }
        return {
          ...current,
          phase: nextNewDeckGenerationPhase({
            phase: current.phase,
            generating: false,
            waitingOnQuestions: false,
            waitExpired: true,
          }),
        };
      });
    }, NEW_DECK_GENERATION_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [
    currentLifecycle.isNewDeckCreation,
    currentLifecycle.phase,
    deckId,
    generating,
    waitingOnQuestions,
  ]);

  useEffect(() => {
    if (
      currentLifecycle.phase !== "started" ||
      generating ||
      !currentLifecycle.isNewDeckCreation
    ) {
      return;
    }
    setLifecycle((current) =>
      current.deckId === deckId && current.phase === "started"
        ? { ...current, isNewDeckCreation: false }
        : current,
    );
  }, [
    currentLifecycle.isNewDeckCreation,
    currentLifecycle.phase,
    deckId,
    generating,
  ]);

  return {
    isNewDeckCreation: currentLifecycle.isNewDeckCreation,
    phase: currentLifecycle.phase,
  };
}

type NewDeckGenerationRun = {
  deckId: string;
  submitMessageId: string | null;
  isNewDeckRoute: boolean;
  tabId: string | null;
};

const runTabIds = new Map<string, string>();

export function clearNewDeckGenerationRun(
  deckId: string,
  submitMessageId: string,
): void {
  const key = getRunTabStorageKey(deckId, submitMessageId);
  runTabIds.delete(key);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The in-memory mapping is already cleared.
  }
}

export function useNewDeckGenerationRun(
  deckId: string,
  isNewDeckRoute: boolean,
  submitMessageId: string | null,
): boolean {
  const [run, setRun] = useState<NewDeckGenerationRun>(() =>
    createRun(deckId, isNewDeckRoute, submitMessageId),
  );
  const startsNewRoute = isNewDeckRoute && !run.isNewDeckRoute;
  const newSubmit = submitMessageId && submitMessageId !== run.submitMessageId;
  const clearsFinishedSubmit =
    !isNewDeckRoute && !submitMessageId && run.submitMessageId !== null;
  let currentRun = run;
  if (
    run.deckId !== deckId ||
    startsNewRoute ||
    newSubmit ||
    clearsFinishedSubmit
  ) {
    currentRun = createRun(deckId, isNewDeckRoute, submitMessageId);
    setRun(currentRun);
  } else if (run.isNewDeckRoute !== isNewDeckRoute) {
    currentRun = { ...run, isNewDeckRoute };
    setRun(currentRun);
  }

  const runKey = `${currentRun.deckId}:${currentRun.submitMessageId}:${currentRun.tabId}`;
  const [activeRun, setActiveRun] = useState({ runKey, generating: false });
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (activeRun.runKey !== runKey) {
    setActiveRun({ runKey, generating: false });
  }

  useEffect(() => {
    const submitId = currentRun.submitMessageId;
    if (!submitId) return;
    const handleSubmitTarget = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.submitMessageId !== submitId ||
        typeof detail?.tabId !== "string"
      ) {
        return;
      }
      rememberRunTabId(currentRun.deckId, submitId, detail.tabId);
      setRun((previous) =>
        previous.deckId === currentRun.deckId &&
        previous.submitMessageId === submitId
          ? { ...previous, tabId: detail.tabId }
          : previous,
      );
    };
    window.addEventListener("agentNative.chatSubmitTarget", handleSubmitTarget);
    return () =>
      window.removeEventListener(
        "agentNative.chatSubmitTarget",
        handleSubmitTarget,
      );
  }, [currentRun.deckId, currentRun.submitMessageId]);

  useEffect(() => {
    const tabId = currentRun.tabId;
    if (!tabId) return;
    const clearStopDebounce = () => {
      if (stopDebounceRef.current !== null) {
        clearTimeout(stopDebounceRef.current);
        stopDebounceRef.current = null;
      }
    };
    const handleChatRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.threadId !== tabId && detail?.tabId !== tabId) {
        return;
      }
      if (detail.isRunning === true) {
        clearStopDebounce();
        setActiveRun({ runKey, generating: true });
      } else if (detail.isRunning === false) {
        clearStopDebounce();
        if (detail.reason === "stopped") {
          setActiveRun({ runKey, generating: false });
        } else {
          stopDebounceRef.current = setTimeout(() => {
            stopDebounceRef.current = null;
            setActiveRun({ runKey, generating: false });
          }, CHAT_STOP_DEBOUNCE_MS);
        }
      }
    };
    const handleRunError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.tabId !== tabId) return;
      clearStopDebounce();
      setActiveRun({ runKey, generating: false });
    };
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    window.addEventListener("agent-chat:run-error", handleRunError);
    return () => {
      clearStopDebounce();
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
      window.removeEventListener("agent-chat:run-error", handleRunError);
    };
  }, [currentRun.tabId, runKey]);

  return activeRun.runKey === runKey && activeRun.generating;
}

function createRun(
  deckId: string,
  isNewDeckRoute: boolean,
  submitMessageId: string | null,
): NewDeckGenerationRun {
  return {
    deckId,
    submitMessageId,
    isNewDeckRoute,
    tabId: submitMessageId ? getRunTabId(deckId, submitMessageId) : null,
  };
}

function getRunTabStorageKey(deckId: string, submitMessageId: string): string {
  return `slides:new-deck-generation:${deckId}:${submitMessageId}`;
}

function getRunTabId(deckId: string, submitMessageId: string): string | null {
  const key = getRunTabStorageKey(deckId, submitMessageId);
  const inMemory = runTabIds.get(key);
  if (inMemory) return inMemory;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored) runTabIds.set(key, stored);
    return stored;
  } catch {
    return null;
  }
}

function rememberRunTabId(
  deckId: string,
  submitMessageId: string,
  tabId: string,
): void {
  const key = getRunTabStorageKey(deckId, submitMessageId);
  runTabIds.set(key, tabId);
  try {
    window.sessionStorage.setItem(key, tabId);
  } catch {
    // The in-memory mapping still covers the route transition.
  }
}

function createLifecycle(
  deckId: string,
  isNewDeckCreation: boolean,
): NewDeckGenerationLifecycle {
  return {
    deckId,
    isNewDeckCreation,
    isNewDeckRoute: isNewDeckCreation,
    phase: "pending",
  };
}
