export interface RewindRecordingStartPhases<TPrepared, TStarted> {
  prepare(): Promise<TPrepared>;
  countdown(): Promise<void>;
  activate(prepared: TPrepared): Promise<TStarted>;
  onActivated?(): void;
}

/**
 * Keep setup work ahead of the numeric countdown so zero is a media boundary,
 * not the beginning of another asynchronous setup pipeline.
 */
export async function prepareRewindRecordingStart<TPrepared, TStarted>(
  phases: RewindRecordingStartPhases<TPrepared, TStarted>,
): Promise<TStarted> {
  const prepared = await phases.prepare();
  await phases.countdown();
  const started = await phases.activate(prepared);
  phases.onActivated?.();
  return started;
}
