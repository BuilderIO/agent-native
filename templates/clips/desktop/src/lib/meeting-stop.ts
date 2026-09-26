interface StopMeetingBeforeTranscriptFlushOptions {
  stopRecording: () => Promise<void>;
  waitForHistory: () => Promise<void>;
  flushTranscript: () => Promise<void>;
}

export async function stopMeetingBeforeTranscriptFlush({
  stopRecording,
  waitForHistory,
  flushTranscript,
}: StopMeetingBeforeTranscriptFlushOptions): Promise<void> {
  await stopRecording();
  await waitForHistory();
  await flushTranscript();
}
