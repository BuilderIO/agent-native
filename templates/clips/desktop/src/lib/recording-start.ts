export async function settleRecordingStart<T>(
  started: T,
  options: {
    stopRequested: boolean;
    requestLookback: () => void;
    finishStop: (started: T) => Promise<void>;
  },
): Promise<{ handle: T | null; stoppedDuringStart: boolean }> {
  options.requestLookback();
  if (!options.stopRequested) {
    return { handle: started, stoppedDuringStart: false };
  }

  await options.finishStop(started);
  return { handle: null, stoppedDuringStart: true };
}
