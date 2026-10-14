export interface RewindRecordingStartPhases<TPrepared, TStarted> {
  prepare(): Promise<TPrepared>;
  countdown(): Promise<void>;
  cancelCountdown(): void;
  beforeActivate?(): Promise<void>;
  activate(prepared: TPrepared): Promise<TStarted>;
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
  let prepared: TPrepared;
  try {
    [prepared] = await Promise.all([preparedPromise, countdownPromise]);
  } catch (err) {
    phases.cancelCountdown();
    if (preparationFailed) {
      await Promise.allSettled([countdownPromise]);
    } else {
      void preparedPromise.catch(() => {});
    }
    throw err;
  }
  await phases.beforeActivate?.();
  const started = await phases.activate(prepared);
  return started;
}
