import { formatClientFailureReport } from "@agent-native/core/client/failure-report";

const MAX_NOTE_CHARS = 600;

/**
 * "Copy details" for a thumbs-down: the same packet an error card copies, so a
 * pasted report opens the exact thread and run, plus the message and the
 * reader's note flattened to one line.
 */
export function formatFeedbackReport(input: {
  threadId: string;
  runId?: string;
  messageId: string;
  note: string;
}): string {
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);
  return [
    formatClientFailureReport({
      threadId: input.threadId,
      ...(input.runId ? { runId: input.runId } : {}),
    }),
    `message: ${input.messageId}`,
    note ? `note: ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
