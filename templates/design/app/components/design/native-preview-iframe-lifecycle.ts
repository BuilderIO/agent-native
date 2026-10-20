export function setNativePreviewIframeRef(
  ref: { current: HTMLIFrameElement | null },
  next: HTMLIFrameElement | null,
): void {
  const previous = ref.current;
  let runtime: { dispose(): Promise<void> } | undefined;
  try {
    if (previous && previous !== next && previous.contentDocument) {
      runtime = previous.contentWindow?.__anNativeShaders;
    }
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("name" in error) ||
      error.name !== "SecurityError"
    ) {
      throw error;
    }
  }
  void runtime?.dispose();
  ref.current = next;
}
