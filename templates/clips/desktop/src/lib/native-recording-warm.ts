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
