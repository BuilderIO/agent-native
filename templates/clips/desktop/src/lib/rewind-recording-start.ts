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
  const preparedPromise = phases.prepare();
  const countdownPromise = phases.countdown();
  let prepared: TPrepared;
  try {
    [prepared] = await Promise.all([preparedPromise, countdownPromise]);
  } catch (err) {
    phases.cancelCountdown();
    await Promise.allSettled([preparedPromise, countdownPromise]);
    throw err;
  }
  await phases.beforeActivate?.();
  const started = await phases.activate(prepared);
  return started;
}
