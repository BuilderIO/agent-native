/**
 * Hosted native start sequencing: create the recording, warm its one physical
 * SCK capture (which registers the shared audio producer), then attach Whisper
 * as a PCM subscriber. The countdown still hides this work, while the ordering
 * prevents a second microphone capture from muting both consumers.
 */
export function planNativeFullscreenWarmOverlap<
  TRecording extends { id: string },
>(input: {
  createRecording: () => Promise<TRecording>;
  startTranscription: () => Promise<unknown>;
  warmMic: (recordingId: string) => Promise<unknown>;
}): Promise<TRecording> {
  return (async () => {
    const created = await input.createRecording();
    await input.warmMic(created.id);
    await input.startTranscription();
    return created;
  })();
}
