import { useEffect, useState } from "react";

import {
  NEW_DECK_GENERATION_START_TIMEOUT_MS,
  nextNewDeckGenerationPhase,
  type NewDeckGenerationPhase,
} from "@/lib/generation-state";

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
