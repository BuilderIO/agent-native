/**
 * Hosted native start sequencing: overlap Whisper start, create-recording, and
 * deferred SCK warm so Skip no longer waits serially on Whisper then warm.
 * Begin/attach must still wait for this promise (transcription settled).
 */
export function planNativeFullscreenWarmOverlap<
  TRecording extends { id: string },
>(input: {
  createRecording: () => Promise<TRecording>;
  startTranscription: () => Promise<unknown>;
  warmMic: (recordingId: string) => Promise<unknown>;
}): Promise<TRecording> {
  const transcriptionPromise = input.startTranscription();
  return (async () => {
    const created = await input.createRecording();
    // Deferred-output warm may overlap remaining Whisper startup; frames are
    // not written until begin attaches the recording output.
    await Promise.all([transcriptionPromise, input.warmMic(created.id)]);
    return created;
  })();
}
