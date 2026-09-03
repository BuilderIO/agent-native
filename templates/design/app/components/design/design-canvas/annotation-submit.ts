interface SubmitDesignAnnotationsOptions {
  message: string;
  hasQueuedPins: boolean;
  /**
   * Deliver the message to the agent chat. Must reject (or throw) when
   * delivery is not confirmed — e.g. `sendToAgentChatAndConfirm` resolving
   * `delivered: false` should be turned into a thrown/rejected error here.
   * A `send` that only fires-and-forgets (never throws on silent drops) will
   * make this function report success even though nothing reached the agent.
   */
  send: (message: string) => void | Promise<void>;
  markQueuedPinsSubmitted: () => void;
  exitDrawMode: () => void;
  onError: (error: unknown) => void;
}

/**
 * Submit a drawing/comment batch as one atomic UI transition.
 *
 * The overlay and queued pins must remain intact when chat handoff fails so the
 * user can retry without recreating their annotation work. `send` is awaited
 * so a caller using an ack-confirmed delivery (e.g.
 * `sendToAgentChatAndConfirm`) can reject when the message was silently
 * dropped (no LLM/agent engine configured, panel never mounted, etc.) — the
 * pins/draw-mode teardown below only runs once delivery is confirmed.
 */
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
