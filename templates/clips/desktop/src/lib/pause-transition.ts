export interface PauseTransitionQueue {
  request(paused: boolean): void;
  getAppliedPaused(): boolean;
  getDesiredPaused(): boolean;
  isTransitioning(): boolean;
  synchronize(paused: boolean): void;
  dispose(): void;
}

interface PauseTransitionOptions {
  initialPaused?: boolean;
  apply(paused: boolean): Promise<void> | void;
  onRequested?(paused: boolean): void;
  onApplied?(paused: boolean): void;
  onError?(error: unknown, attemptedPaused: boolean): void;
}

export function createPauseTransitionQueue(
  options: PauseTransitionOptions,
): PauseTransitionQueue {
  let appliedPaused = options.initialPaused ?? false;
  let desiredPaused = appliedPaused;
  let transitioning = false;
  let disposed = false;

  const applyDesiredState = async (): Promise<void> => {
    if (disposed || transitioning || desiredPaused === appliedPaused) return;

    transitioning = true;
    const targetPaused = desiredPaused;
    let applied = false;
    try {
      await options.apply(targetPaused);
      applied = true;
    } catch (error) {
      if (!disposed) {
        desiredPaused = appliedPaused;
        options.onError?.(error, targetPaused);
      }
    } finally {
      transitioning = false;
    }

    if (disposed) return;
    if (applied) {
      appliedPaused = targetPaused;
      options.onApplied?.(targetPaused);
    }

    void applyDesiredState();
  };

  return {
    request(paused) {
      if (disposed || paused === desiredPaused) return;
      desiredPaused = paused;
      options.onRequested?.(paused);
      void applyDesiredState();
    },
    getAppliedPaused: () => appliedPaused,
    getDesiredPaused: () => desiredPaused,
    isTransitioning: () => transitioning,
    synchronize(paused) {
      if (disposed || transitioning) return;
      appliedPaused = paused;
      desiredPaused = paused;
    },
    dispose() {
      disposed = true;
    },
  };
}
