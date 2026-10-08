import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { nanoid } from "nanoid";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  NEW_DECK_GENERATION_START_TIMEOUT_MS,
  nextNewDeckGenerationPhase,
  type NewDeckGenerationPhase,
} from "@/lib/generation-state";

import { CHAT_STOP_DEBOUNCE_MS } from "./use-agent-generating";

export const NEW_DECK_GENERATION_SUBMIT_TARGET_EVENT =
  "agentNative.chatSubmitTarget";
const NEW_DECK_GENERATION_RUN_CLEARED_EVENT =
  "slides:new-deck-generation:cleared";

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
      waitingOnQuestions ||
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
    waitingOnQuestions,
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
  conversationThreadId: string | null;
};

type NewDeckGenerationRunReference = {
  submitMessageId: string;
  tabId: string;
  conversationThreadId?: string;
};

const runTabIds = new Map<string, string>();
const runConversationThreadIds = new Map<string, string>();

export function clearNewDeckGenerationRun(
  deckId: string,
  submitMessageId: string,
): void {
  const key = getRunTabStorageKey(deckId, submitMessageId);
  runTabIds.delete(key);
  runConversationThreadIds.delete(key);
  window.sessionStorage.removeItem(key);
  window.sessionStorage.removeItem(
    getRunConversationThreadStorageKey(deckId, submitMessageId),
  );
  const activeRun = getActiveRun(deckId);
  if (activeRun?.submitMessageId === submitMessageId) {
    window.sessionStorage.removeItem(getActiveRunStorageKey(deckId));
  }
  window.dispatchEvent(
    new CustomEvent(NEW_DECK_GENERATION_RUN_CLEARED_EVENT, {
      detail: { deckId, submitMessageId },
    }),
  );
}

export function useNewDeckGenerationRun(
  deckId: string,
  isNewDeckRoute: boolean,
  submitMessageId: string | null,
): {
  generating: boolean;
  submitMessageId: string | null;
  tabId: string | null;
  conversationThreadId: string | null;
  questionContinuationPending: boolean;
  expectQuestionContinuation: (submitMessageId: string) => void;
  submitQuestionContinuation: (input: {
    message: string;
    context: string;
  }) => Promise<{ delivered: boolean }>;
} {
  const [run, setRun] = useState<NewDeckGenerationRun>(() =>
    createRun(deckId, isNewDeckRoute, submitMessageId),
  );
  const startsNewRoute = isNewDeckRoute && !run.isNewDeckRoute;
  const newSubmit = submitMessageId && submitMessageId !== run.submitMessageId;
  const storedActiveRun = getActiveRun(deckId);
  const restoresActiveRun =
    run.submitMessageId !== null &&
    storedActiveRun?.submitMessageId === run.submitMessageId;
  const clearsFinishedSubmit =
    !isNewDeckRoute &&
    !submitMessageId &&
    run.submitMessageId !== null &&
    !restoresActiveRun;
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

  const previousRunRef = useRef(currentRun);
  useEffect(() => {
    const previous = previousRunRef.current;
    if (
      previous.submitMessageId &&
      (previous.deckId !== currentRun.deckId ||
        previous.submitMessageId !== currentRun.submitMessageId)
    ) {
      const hasRecoverableRun =
        previous.deckId !== currentRun.deckId &&
        hasStoredNewDeckGenerationRun(
          previous.deckId,
          previous.submitMessageId,
        );
      if (!hasRecoverableRun) {
        clearNewDeckGenerationRun(previous.deckId, previous.submitMessageId);
      }
    }
    previousRunRef.current = currentRun;
  }, [currentRun.deckId, currentRun.submitMessageId]);

  useEffect(() => {
    const handleRunCleared = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.deckId !== currentRunRef.current.deckId ||
        detail?.submitMessageId !== currentRunRef.current.submitMessageId
      ) {
        return;
      }
      setRun({
        deckId: detail.deckId,
        submitMessageId: null,
        isNewDeckRoute: false,
        tabId: null,
        conversationThreadId: null,
      });
    };
    window.addEventListener(
      NEW_DECK_GENERATION_RUN_CLEARED_EVENT,
      handleRunCleared,
    );
    return () =>
      window.removeEventListener(
        NEW_DECK_GENERATION_RUN_CLEARED_EVENT,
        handleRunCleared,
      );
  }, []);

  const currentRunRef = useRef(currentRun);
  currentRunRef.current = currentRun;
  const routeCleanupTokenRef = useRef<symbol | null>(null);
  useEffect(() => {
    const token = Symbol();
    routeCleanupTokenRef.current = token;
    return () => {
      const runAtExit = currentRunRef.current;
      queueMicrotask(() => {
        if (
          routeCleanupTokenRef.current === token &&
          runAtExit.submitMessageId &&
          !runAtExit.tabId &&
          !hasStoredNewDeckGenerationRun(
            runAtExit.deckId,
            runAtExit.submitMessageId,
          )
        ) {
          clearNewDeckGenerationRun(
            runAtExit.deckId,
            runAtExit.submitMessageId,
          );
        }
      });
    };
  }, []);

  const runKey = `${currentRun.deckId}:${currentRun.submitMessageId}:${currentRun.tabId}`;
  const [activeRun, setActiveRun] = useState({ runKey, generating: false });
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const continuationTargetTabIdRef = useRef<string | null>(null);
  const continuationSubmitMessageIdRef = useRef<string | null>(null);
  const [continuation, setContinuation] = useState({
    runKey,
    submitMessageId: null as string | null,
  });
  const currentContinuation =
    continuation.runKey === runKey
      ? continuation
      : { runKey, submitMessageId: null };
  if (continuation.runKey !== runKey) {
    continuationTargetTabIdRef.current = null;
    continuationSubmitMessageIdRef.current = null;
    setContinuation(currentContinuation);
  }
  if (activeRun.runKey !== runKey) {
    setActiveRun({ runKey, generating: false });
  }
  const expectQuestionContinuation = useCallback(
    (continuationSubmitMessageId: string) => {
      continuationTargetTabIdRef.current = null;
      continuationSubmitMessageIdRef.current = continuationSubmitMessageId;
      setContinuation({
        runKey,
        submitMessageId: continuationSubmitMessageId,
      });
    },
    [runKey],
  );
  const submitQuestionContinuation = useCallback(
    ({ message, context }: { message: string; context: string }) => {
      const submitMessageId = nanoid();
      expectQuestionContinuation(submitMessageId);
      const submission = sendToAgentChatAndConfirm(
        {
          message,
          context,
          chatTarget: "local",
          submit: true,
          ...(currentRun.tabId ? { targetTabId: currentRun.tabId } : {}),
        },
        { submitMessageId },
      );
      void submission.then(({ delivered }) => {
        if (delivered) return;
        continuationTargetTabIdRef.current = null;
        if (continuationSubmitMessageIdRef.current === submitMessageId) {
          continuationSubmitMessageIdRef.current = null;
          setContinuation((previous) =>
            previous.runKey === runKey &&
            previous.submitMessageId === submitMessageId
              ? { runKey, submitMessageId: null }
              : previous,
          );
        }
      });
      return submission;
    },
    [currentRun.tabId, expectQuestionContinuation],
  );

  useEffect(() => {
    const continuationSubmitId = currentContinuation.submitMessageId;
    if (!continuationSubmitId) return;
    const timer = setTimeout(() => {
      if (continuationSubmitMessageIdRef.current === continuationSubmitId) {
        continuationTargetTabIdRef.current = null;
        continuationSubmitMessageIdRef.current = null;
      }
      setContinuation((previous) =>
        previous.runKey === runKey &&
        previous.submitMessageId === continuationSubmitId
          ? { runKey, submitMessageId: null }
          : previous,
      );
    }, NEW_DECK_GENERATION_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [currentContinuation.submitMessageId, runKey]);

  const tabIdRef = useRef(currentRun.tabId);
  useLayoutEffect(() => {
    const submitId = currentRun.submitMessageId;
    if (!submitId) return;
    const handleSubmitTarget = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.submitMessageId !== submitId ||
        typeof detail?.tabId !== "string"
      ) {
        if (
          detail?.submitMessageId === continuationSubmitMessageIdRef.current &&
          detail?.tabId === currentRun.tabId
        ) {
          continuationTargetTabIdRef.current = detail.tabId;
        }
        return;
      }
      tabIdRef.current = detail.tabId;
      setRun((previous) =>
        previous.deckId === currentRun.deckId &&
        previous.submitMessageId === submitId
          ? { ...previous, tabId: detail.tabId }
          : previous,
      );
      rememberNewDeckGenerationRunTab(
        currentRun.deckId,
        submitId,
        detail.tabId,
      );
    };
    window.addEventListener(
      NEW_DECK_GENERATION_SUBMIT_TARGET_EVENT,
      handleSubmitTarget,
    );
    return () =>
      window.removeEventListener(
        NEW_DECK_GENERATION_SUBMIT_TARGET_EVENT,
        handleSubmitTarget,
      );
  }, [currentRun.deckId, currentRun.submitMessageId, currentRun.tabId]);

  useLayoutEffect(() => {
    const submitId = currentRun.submitMessageId;
    if (!submitId) return;
    const deckId = currentRun.deckId;
    tabIdRef.current = currentRun.tabId;
    const getRunKey = () => `${deckId}:${submitId}:${tabIdRef.current}`;
    const clearStopDebounce = () => {
      if (stopDebounceRef.current !== null) {
        clearTimeout(stopDebounceRef.current);
        stopDebounceRef.current = null;
      }
    };
    const handleChatRunning = (event: Event) => {
      const tabId = tabIdRef.current;
      if (!tabId) return;
      const detail = (event as CustomEvent).detail;
      const eventTabId =
        typeof detail?.tabId === "string" ? detail.tabId : null;
      const eventThreadId =
        typeof detail?.threadId === "string" ? detail.threadId : null;
      if (
        eventTabId !== tabId &&
        !(eventTabId === null && eventThreadId === tabId)
      ) {
        return;
      }
      const runAtEvent = currentRunRef.current;
      if (
        eventThreadId &&
        runAtEvent.submitMessageId === submitId &&
        runAtEvent.conversationThreadId !== eventThreadId
      ) {
        setRun((previous) =>
          previous.deckId === deckId && previous.submitMessageId === submitId
            ? { ...previous, conversationThreadId: eventThreadId }
            : previous,
        );
        rememberNewDeckGenerationRunConversationThread(
          deckId,
          submitId,
          eventThreadId,
        );
      }
      if (detail.isRunning === true) {
        clearStopDebounce();
        setActiveRun({ runKey: getRunKey(), generating: true });
        if (continuationTargetTabIdRef.current === tabId) {
          continuationTargetTabIdRef.current = null;
          continuationSubmitMessageIdRef.current = null;
          setContinuation((previous) =>
            previous.runKey === getRunKey()
              ? { runKey: getRunKey(), submitMessageId: null }
              : previous,
          );
        }
      } else if (detail.isRunning === false) {
        clearStopDebounce();
        if (detail.reason === "stopped") {
          setActiveRun({ runKey: getRunKey(), generating: false });
        } else {
          stopDebounceRef.current = setTimeout(() => {
            stopDebounceRef.current = null;
            setActiveRun({ runKey: getRunKey(), generating: false });
          }, CHAT_STOP_DEBOUNCE_MS);
        }
      }
    };
    const handleRunError = (event: Event) => {
      const tabId = tabIdRef.current;
      if (!tabId) return;
      const detail = (event as CustomEvent).detail;
      if (detail?.tabId !== tabId) return;
      clearStopDebounce();
      setActiveRun({ runKey: getRunKey(), generating: false });
      if (continuationTargetTabIdRef.current === tabId) {
        continuationTargetTabIdRef.current = null;
        continuationSubmitMessageIdRef.current = null;
        setContinuation((previous) =>
          previous.runKey === getRunKey()
            ? { runKey: getRunKey(), submitMessageId: null }
            : previous,
        );
      }
    };
    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    window.addEventListener("agent-chat:run-error", handleRunError);
    return () => {
      clearStopDebounce();
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
      window.removeEventListener("agent-chat:run-error", handleRunError);
    };
  }, [currentRun.deckId, currentRun.submitMessageId]);

  return {
    generating: activeRun.runKey === runKey && activeRun.generating,
    submitMessageId: currentRun.submitMessageId,
    tabId: currentRun.tabId,
    conversationThreadId: currentRun.conversationThreadId,
    questionContinuationPending: currentContinuation.submitMessageId !== null,
    expectQuestionContinuation,
    submitQuestionContinuation,
  };
}

function createRun(
  deckId: string,
  isNewDeckRoute: boolean,
  submitMessageId: string | null,
): NewDeckGenerationRun {
  const activeRun = submitMessageId ? null : getActiveRun(deckId);
  const currentSubmitMessageId =
    submitMessageId ?? activeRun?.submitMessageId ?? null;
  return {
    deckId,
    submitMessageId: currentSubmitMessageId,
    isNewDeckRoute: isNewDeckRoute || currentSubmitMessageId !== null,
    tabId: currentSubmitMessageId
      ? (getRunTabId(deckId, currentSubmitMessageId) ??
        (activeRun?.submitMessageId === currentSubmitMessageId
          ? activeRun.tabId
          : null))
      : null,
    conversationThreadId: currentSubmitMessageId
      ? (getRunConversationThreadId(deckId, currentSubmitMessageId) ??
        (activeRun?.submitMessageId === currentSubmitMessageId
          ? (activeRun.conversationThreadId ?? null)
          : null))
      : null,
  };
}

function getRunTabStorageKey(deckId: string, submitMessageId: string): string {
  return `slides:new-deck-generation:${deckId}:${submitMessageId}`;
}

function getRunConversationThreadStorageKey(
  deckId: string,
  submitMessageId: string,
): string {
  return `slides:new-deck-generation-thread:${deckId}:${submitMessageId}`;
}

function getActiveRunStorageKey(deckId: string): string {
  return `slides:new-deck-generation-active:${deckId}`;
}

function getActiveRun(deckId: string): NewDeckGenerationRunReference | null {
  if (typeof window === "undefined") return null;
  const serialized = window.sessionStorage.getItem(
    getActiveRunStorageKey(deckId),
  );
  if (!serialized) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `Cannot restore Slides generation ownership for deck ${deckId}: invalid session data.`,
      { cause: error },
    );
  }
  const run =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  if (
    !run ||
    typeof run.submitMessageId !== "string" ||
    typeof run.tabId !== "string"
  ) {
    throw new Error(
      `Cannot restore Slides generation ownership for deck ${deckId}: invalid session data.`,
    );
  }
  if (
    "conversationThreadId" in run &&
    typeof run.conversationThreadId !== "string"
  ) {
    throw new Error(
      `Cannot restore Slides generation ownership for deck ${deckId}: invalid session data.`,
    );
  }
  return {
    submitMessageId: run.submitMessageId,
    tabId: run.tabId,
    ...(typeof run.conversationThreadId === "string"
      ? { conversationThreadId: run.conversationThreadId }
      : {}),
  };
}

function hasStoredNewDeckGenerationRun(
  deckId: string,
  submitMessageId: string,
): boolean {
  return getActiveRun(deckId)?.submitMessageId === submitMessageId;
}

function getRunTabId(deckId: string, submitMessageId: string): string | null {
  if (typeof window === "undefined") return null;
  const key = getRunTabStorageKey(deckId, submitMessageId);
  const inMemory = runTabIds.get(key);
  if (inMemory) return inMemory;
  const stored = window.sessionStorage.getItem(key);
  if (stored) runTabIds.set(key, stored);
  return stored;
}

function getRunConversationThreadId(
  deckId: string,
  submitMessageId: string,
): string | null {
  if (typeof window === "undefined") return null;
  const key = getRunTabStorageKey(deckId, submitMessageId);
  const inMemory = runConversationThreadIds.get(key);
  if (inMemory) return inMemory;
  const stored = window.sessionStorage.getItem(
    getRunConversationThreadStorageKey(deckId, submitMessageId),
  );
  if (stored === null) return null;
  if (!stored.trim()) {
    throw new Error(
      `Cannot restore Slides generation ownership for deck ${deckId}: invalid session data.`,
    );
  }
  runConversationThreadIds.set(key, stored);
  return stored;
}

export function rememberNewDeckGenerationRunTab(
  deckId: string,
  submitMessageId: string,
  tabId: string,
): void {
  const key = getRunTabStorageKey(deckId, submitMessageId);
  runTabIds.set(key, tabId);
  window.sessionStorage.setItem(key, tabId);
  const conversationThreadId = getRunConversationThreadId(
    deckId,
    submitMessageId,
  );
  window.sessionStorage.setItem(
    getActiveRunStorageKey(deckId),
    JSON.stringify({
      submitMessageId,
      tabId,
      ...(conversationThreadId ? { conversationThreadId } : {}),
    } satisfies NewDeckGenerationRunReference),
  );
}

export function rememberNewDeckGenerationRunConversationThread(
  deckId: string,
  submitMessageId: string,
  conversationThreadId: string,
): void {
  const normalizedThreadId = conversationThreadId.trim();
  if (!normalizedThreadId) return;
  const key = getRunTabStorageKey(deckId, submitMessageId);
  const tabId = getRunTabId(deckId, submitMessageId);
  if (!tabId) return;
  runConversationThreadIds.set(key, normalizedThreadId);
  window.sessionStorage.setItem(
    getRunConversationThreadStorageKey(deckId, submitMessageId),
    normalizedThreadId,
  );
  const activeRun = getActiveRun(deckId);
  if (activeRun?.submitMessageId !== submitMessageId) return;
  window.sessionStorage.setItem(
    getActiveRunStorageKey(deckId),
    JSON.stringify({
      ...activeRun,
      conversationThreadId: normalizedThreadId,
    } satisfies NewDeckGenerationRunReference),
  );
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
