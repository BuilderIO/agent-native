import { useEffect, useRef, useState, type AnimationEvent } from "react";

export const COMPLETE_EXIT_MS = 260;
export const COMPLETE_SETTLE_MS = 220;
const ANIMATION_FALLBACK_BUFFER_MS = 40;

export const EXIT_ANIMATION_NAME = "task-row-exit";
export const COMPLETE_ANIMATION_NAME = "task-row-complete";
export const RESTORE_ANIMATION_NAME = "task-row-restore";

export type CompletionPhase = "idle" | "completing" | "uncompleting" | "exited";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface UseTaskRowCompletionAnimationOptions {
  taskDone: boolean;
  hideAfterComplete: boolean;
  onBeginExit?: () => void;
  onExitAfterComplete?: () => void;
  onUpdateTask: (patch: { done: boolean }) => Promise<unknown>;
}

export function useTaskRowCompletionAnimation({
  taskDone,
  hideAfterComplete,
  onBeginExit,
  onExitAfterComplete,
  onUpdateTask,
}: UseTaskRowCompletionAnimationOptions) {
  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>("idle");
  const animationFallbackRef = useRef<number | null>(null);
  const latestTaskDoneRef = useRef(taskDone);

  const displayDone =
    completionPhase === "completing" || completionPhase === "exited"
      ? true
      : completionPhase === "uncompleting"
        ? false
        : taskDone;
  const isAnimating =
    completionPhase === "completing" || completionPhase === "uncompleting";

  useEffect(() => {
    latestTaskDoneRef.current = taskDone;
    if (completionPhase === "uncompleting" && !taskDone) {
      resetCompletionPhase();
    }
  }, [completionPhase, taskDone]);

  useEffect(() => {
    return () => {
      if (animationFallbackRef.current !== null) {
        window.clearTimeout(animationFallbackRef.current);
      }
    };
  }, []);

  function clearAnimationFallback() {
    if (animationFallbackRef.current !== null) {
      window.clearTimeout(animationFallbackRef.current);
      animationFallbackRef.current = null;
    }
  }

  function resetCompletionPhase() {
    clearAnimationFallback();
    setCompletionPhase("idle");
  }

  function finishExitAfterComplete() {
    clearAnimationFallback();
    setCompletionPhase((phase) => {
      if (phase === "exited") return phase;
      onExitAfterComplete?.();
      return "exited";
    });
  }

  function finishSettleAnimation() {
    clearAnimationFallback();
    setCompletionPhase((phase) => {
      if (phase === "uncompleting" && latestTaskDoneRef.current) {
        return phase;
      }
      return "idle";
    });
  }

  function scheduleAnimationFallback(callback: () => void, durationMs: number) {
    clearAnimationFallback();
    if (prefersReducedMotion()) {
      callback();
      return;
    }
    animationFallbackRef.current = window.setTimeout(() => {
      animationFallbackRef.current = null;
      callback();
    }, durationMs + ANIMATION_FALLBACK_BUFFER_MS);
  }

  function handleRowAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target) return;

    if (
      event.animationName === EXIT_ANIMATION_NAME &&
      completionPhase === "completing" &&
      hideAfterComplete
    ) {
      finishExitAfterComplete();
      return;
    }

    if (
      event.animationName === COMPLETE_ANIMATION_NAME &&
      completionPhase === "completing"
    ) {
      finishSettleAnimation();
      return;
    }

    if (
      event.animationName === RESTORE_ANIMATION_NAME &&
      completionPhase === "uncompleting"
    ) {
      finishSettleAnimation();
    }
  }

  function commitDoneChange(nextDone: boolean) {
    void onUpdateTask({ done: nextDone })
      .then(() => {
        if (nextDone && hideAfterComplete) {
          return;
        }
        scheduleAnimationFallback(finishSettleAnimation, COMPLETE_SETTLE_MS);
      })
      .catch(resetCompletionPhase);
  }

  function handleDoneToggle(checked: boolean | "indeterminate") {
    if (checked === "indeterminate" || isAnimating || completionPhase === "exited") {
      return;
    }

    const nextDone = checked === true;
    if (nextDone === taskDone) return;

    if (nextDone) {
      if (hideAfterComplete) {
        onBeginExit?.();
      }
      setCompletionPhase("completing");
      if (hideAfterComplete) {
        scheduleAnimationFallback(finishExitAfterComplete, COMPLETE_EXIT_MS);
      }
      commitDoneChange(true);
      return;
    }

    setCompletionPhase("uncompleting");
    commitDoneChange(false);
  }

  return {
    completionPhase,
    displayDone,
    isAnimating,
    handleDoneToggle,
    handleRowAnimationEnd,
  };
}
