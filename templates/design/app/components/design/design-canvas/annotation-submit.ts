interface SubmitDesignAnnotationsOptions {
  message: string;
  hasQueuedPins: boolean;
  send: (message: string) => void | Promise<void>;
  markQueuedPinsSubmitted: () => void;
  exitDrawMode: () => void;
  onError: (error: unknown) => void;
}

export async function submitDesignAnnotations({
  message,
  hasQueuedPins,
  send,
  markQueuedPinsSubmitted,
  exitDrawMode,
  onError,
}: SubmitDesignAnnotationsOptions): Promise<boolean> {
  try {
    await send(message);
  } catch (error) {
    onError(error);
    return false;
  }

  if (hasQueuedPins) markQueuedPinsSubmitted();
  exitDrawMode();
  return true;
}
