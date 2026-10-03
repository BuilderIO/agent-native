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
  const preparation = phases.prepare();
  const countdown = phases.countdown();
  let prepared: TPrepared;
  try {
    [prepared] = await Promise.all([preparation, countdown]);
  } catch (error) {
    phases.cancelCountdown();
    await Promise.allSettled([preparation, countdown]);
    throw error;
  }
  await phases.beforeActivate?.();
  return phases.activate(prepared);
}
