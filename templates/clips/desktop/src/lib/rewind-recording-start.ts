export interface RewindRecordingStartPhases<TPrepared, TStarted> {
  prepare(): Promise<TPrepared>;
  countdown(): Promise<void>;
  cancelCountdown(): void;
  activate(prepared: TPrepared): Promise<TStarted>;
  onActivated?(): void;
}

export async function prepareRewindRecordingStart<TPrepared, TStarted>(
  phases: RewindRecordingStartPhases<TPrepared, TStarted>,
): Promise<TStarted> {
  const preparedPromise = phases.prepare();
  const countdownPromise = phases.countdown();
  void countdownPromise.catch(() => {});
  let prepared: TPrepared;
  try {
    prepared = await preparedPromise;
  } catch (err) {
    phases.cancelCountdown();
    await countdownPromise.catch(() => {});
    throw err;
  }
  await countdownPromise;
  const started = await phases.activate(prepared);
  phases.onActivated?.();
  return started;
}
