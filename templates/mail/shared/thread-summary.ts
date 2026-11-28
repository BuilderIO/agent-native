import type { ConversationSummary, EmailMessage } from "./types";

export function summaryMessages(
  messages: readonly EmailMessage[],
): EmailMessage[] {
  return messages
    .filter((message) => !message.isDraft)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function summaryCovers(
  summary: Pick<ConversationSummary, "lastMessageId" | "messageCount">,
  messages: readonly EmailMessage[],
): boolean {
  const covered = summaryMessages(messages);
  const [latest = null] = covered.slice(-1);
  return (
    latest !== null &&
    summary.lastMessageId === latest.id &&
    summary.messageCount === covered.length
  );
}
