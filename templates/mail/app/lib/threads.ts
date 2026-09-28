import type { EmailMessage } from "@shared/types";

type PreAggregatedThread = EmailMessage & {
  messageCount: number;
  unreadCount: number;
};

function isPreAggregatedThread(
  email: EmailMessage,
): email is PreAggregatedThread {
  return (
    typeof (email as Partial<PreAggregatedThread>).messageCount === "number" &&
    typeof (email as Partial<PreAggregatedThread>).unreadCount === "number"
  );
}

export interface ThreadSummary {
  latestMessage: EmailMessage;
  participants: string[];
  messageCount: number;
  hasUnread: boolean;
  hasStarred: boolean;
  labelIds: string[];
}

export function groupIntoThreads(emails: EmailMessage[]): ThreadSummary[] {
  const threadMap = new Map<string, EmailMessage[]>();

  for (const email of emails) {
    const key = email.threadId || email.id;
    const existing = threadMap.get(key);
    if (existing) {
      existing.push(email);
    } else {
      threadMap.set(key, [email]);
    }
  }

  const threads: ThreadSummary[] = [];

  for (const messages of threadMap.values()) {
    messages.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const latestMessage = messages[messages.length - 1];

    const seen = new Set<string>();
    const participants: string[] = [];
    for (const msg of messages) {
      const name = msg.from.name || msg.from.email;
      if (!seen.has(name)) {
        seen.add(name);
        participants.push(name);
      }
    }

    const labelSet = new Set<string>();
    for (const msg of messages) {
      for (const l of msg.labelIds) labelSet.add(l);
    }

    const aggregate =
      messages.length === 1 && isPreAggregatedThread(messages[0])
        ? messages[0]
        : undefined;

    threads.push({
      latestMessage,
      participants,
      messageCount: aggregate?.messageCount ?? messages.length,
      hasUnread: aggregate
        ? aggregate.unreadCount > 0
        : messages.some((m) => !m.isRead),
      hasStarred: messages.some((m) => m.isStarred),
      labelIds: Array.from(labelSet),
    });
  }

  threads.sort(
    (a, b) =>
      new Date(b.latestMessage.date).getTime() -
        new Date(a.latestMessage.date).getTime() ||
      b.latestMessage.id.localeCompare(a.latestMessage.id),
  );

  return threads;
}
