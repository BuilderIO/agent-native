interface StopMeetingBeforeTranscriptFlushOptions {
  stopRecording: () => Promise<void>;
  waitForHistory: () => Promise<void>;
  flushTranscript: () => Promise<void>;
}

/** Persist the terminal meeting state before waiting on transcript work. */
export async function stopMeetingBeforeTranscriptFlush({
  stopRecording,
  waitForHistory,
  flushTranscript,
}: StopMeetingBeforeTranscriptFlushOptions): Promise<void> {
  await stopRecording();
  await waitForHistory();
  await flushTranscript();
}
