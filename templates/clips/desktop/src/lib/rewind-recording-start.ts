import { showPreparingAfterCountdown } from "./preparing-after-countdown";

export interface RewindRecordingStartPhases<TPrepared, TStarted> {
  prepare(): Promise<TPrepared>;
  countdown(): Promise<void>;
  cancelCountdown(): void;
  beforeActivate?(): Promise<void>;
  activate(prepared: TPrepared): Promise<TStarted>;
  /** Shown while preparation is still running after the countdown ended. */
  preparing?: {
    show(): Promise<void>;
    hide(): Promise<void>;
    delayMs?: number;
  };
}

export async function prepareRewindRecordingStart<TPrepared, TStarted>(
  phases: RewindRecordingStartPhases<TPrepared, TStarted>,
): Promise<TStarted> {
  let preparationFailed = false;
  const preparedPromise = phases.prepare().catch((err) => {
    preparationFailed = true;
    throw err;
  });
  const countdownPromise = phases.countdown();
  const preparing = phases.preparing
    ? showPreparingAfterCountdown(
        countdownPromise,
        preparedPromise,
        phases.preparing,
      )
    : null;
  let prepared: TPrepared;
  try {
    [prepared] = await Promise.all([preparedPromise, countdownPromise]);
  } catch (err) {
    await preparing?.done();
    phases.cancelCountdown();
    if (preparationFailed) {
      await Promise.allSettled([countdownPromise]);
    } else {
      void preparedPromise.catch(() => {});
    }
    throw err;
  }
  try {
    await phases.beforeActivate?.();
    return await phases.activate(prepared);
  } finally {
    await preparing?.done();
  }
}
