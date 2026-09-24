export interface RewindRecordingStartPhases<TPrepared, TStarted> {
  prepare(): Promise<TPrepared>;
  countdown(): Promise<void>;
  /**
   * Tear down a countdown that is still running when `prepare` fails under
   * it. Must make the pending `countdown()` promise settle — it is awaited
   * afterwards so the teardown finishes before the prepare failure surfaces.
   */
  cancelCountdown(): void;
  activate(prepared: TPrepared): Promise<TStarted>;
  onActivated?(): void;
}

/**
 * Show the countdown immediately and run setup work underneath it, so the
 * user never waits on a blank pre-countdown stall. Activation still waits for
 * both: zero is a media boundary only after preparation has succeeded, and a
 * prepare that outlasts the countdown extends the wait rather than starting
 * capture early.
 */
export async function prepareRewindRecordingStart<TPrepared, TStarted>(
  phases: RewindRecordingStartPhases<TPrepared, TStarted>,
): Promise<TStarted> {
  const preparedPromise = phases.prepare();
  const countdownPromise = phases.countdown();
  // Observe the countdown early: a cancel while prepare is still settling
  // below must not fire as an unhandled rejection. It is re-awaited with real
  // handling once prepare's outcome is known.
  void countdownPromise.catch(() => {});
  let prepared: TPrepared;
  try {
    prepared = await preparedPromise;
  } catch (err) {
    phases.cancelCountdown();
    // Wait for the countdown teardown so no orphaned window outlives the
    // failure, but surface the prepare error, not the induced cancel.
    await countdownPromise.catch(() => {});
    throw err;
  }
  await countdownPromise;
  const started = await phases.activate(prepared);
  phases.onActivated?.();
  return started;
}
