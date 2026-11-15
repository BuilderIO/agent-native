// Which queued rows the composer may show.
//
// A "Send now" row is delivered into the running turn and the server drops it from the queue. The client's
// snapshot can keep that row after the run ends, and it then sits on screen as a stuck "Send now" until a
// reload. Four attempts to fix the client's state machine (queue override, prune ordering, thread state,
// load merge) did not change what the tester sees, so the row is filtered where it is rendered, from state
// the UI already holds: the thread's own messages.
//
// The rule is deliberately narrow. A row is hidden only when
//   * no run is active (a queued row at rest cannot be waiting for its own turn), and
//   * the row is not explicitly waiting for after_reply, and
//   * the thread already holds a user message with the same text — the transcript is the proof that the
//     row was delivered.
// Anything else stays visible, so a message that never landed can never be hidden by this filter.

export interface QueuedRowVisibilityInput {
  active: boolean;
  queuedMessages: ReadonlyArray<{
    id: string;
    text: string;
    delivery?: string | undefined;
  }>;
  messages: ReadonlyArray<{ role: string; text: string }>;
}

export function visibleQueuedRows<
  T extends QueuedRowVisibilityInput["queuedMessages"][number],
>(input: QueuedRowVisibilityInput & { queuedMessages: ReadonlyArray<T> }): T[] {
  const queued = [...input.queuedMessages];
  if (input.active) return queued;
  const delivered = new Set(
    input.messages
      .filter((message) => message.role === "user")
      .map((message) => message.text.trim())
      .filter(Boolean),
  );
  return queued.filter((row) => {
    if (row.delivery === "after_reply") return true;
    return !delivered.has(row.text.trim());
  });
}
