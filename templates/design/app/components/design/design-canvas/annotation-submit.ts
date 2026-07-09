interface SubmitDesignAnnotationsOptions {
  message: string;
  hasQueuedPins: boolean;
  send: (message: string) => void;
  markQueuedPinsSubmitted: () => void;
  exitDrawMode: () => void;
  onError: (error: unknown) => void;
}

/**
 * Submit a drawing/comment batch as one atomic UI transition.
 *
 * The overlay and queued pins must remain intact when chat handoff fails so the
 * user can retry without recreating their annotation work.
 */
export function submitDesignAnnotations({
  message,
  hasQueuedPins,
  send,
  markQueuedPinsSubmitted,
  exitDrawMode,
  onError,
}: SubmitDesignAnnotationsOptions): boolean {
  try {
    send(message);
  } catch (error) {
    onError(error);
    return false;
  }

  if (hasQueuedPins) markQueuedPinsSubmitted();
  exitDrawMode();
  return true;
}
