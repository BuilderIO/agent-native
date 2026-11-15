import {
  type PreparingOverlay,
  showPreparingAfterCountdown,
} from "./preparing-after-countdown";

export interface RewindRecordingStartPhases<TPrepared, TStarted> {
  prepare(): Promise<TPrepared>;
  countdown(): Promise<void>;
  cancelCountdown(): void;
  beforeActivate?(): Promise<void>;
  activate(prepared: TPrepared): Promise<TStarted>;
  /** Shown while capture is not live yet after the countdown ended
   * (preparation, start cue or activation still running). */
  preparing?: PreparingOverlay;
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
    ? showPreparingAfterCountdown(countdownPromise, phases.preparing)
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
