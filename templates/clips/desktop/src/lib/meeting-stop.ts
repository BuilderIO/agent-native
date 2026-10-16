interface StopMeetingBeforeTranscriptFlushOptions {
  stopRecording: () => Promise<void>;
  isStopped: () => Promise<boolean>;
  waitForHistory: () => Promise<void>;
  flushTranscript: () => Promise<void>;
}

const STOP_CONFIRMATION_RETRY_DELAYS_MS = [150, 450] as const;

export async function stopMeetingBeforeTranscriptFlush({
  stopRecording,
  isStopped,
  waitForHistory,
  flushTranscript,
}: StopMeetingBeforeTranscriptFlushOptions): Promise<void> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= STOP_CONFIRMATION_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      await stopRecording();
    } catch (error) {
      lastError = error;
    }

    let confirmed = false;
    try {
      confirmed = await isStopped();
    } catch (error) {
      lastError = error;
    }
    if (confirmed) {
      await waitForHistory();
      await flushTranscript();
      return;
    }

    const retryDelayMs = STOP_CONFIRMATION_RETRY_DELAYS_MS[attempt];
    if (retryDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  const error = new Error(
    "The server did not confirm that the meeting recording stopped.",
  );
  if (lastError !== undefined) Object.assign(error, { cause: lastError });
  throw error;
}
