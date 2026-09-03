import type { EmailMessage } from "@shared/types";

export interface ThreadSummary {
  /** The latest message in the thread (used for display and navigation) */
  latestMessage: EmailMessage;
  /** All unique participant names (senders), excluding the user */
  participants: string[];
  /** Total number of messages in the thread */
  messageCount: number;
  /** Whether any message in the thread is unread */
  hasUnread: boolean;
  /** Whether any message in the thread is starred */
  hasStarred: boolean;
  /** Union of all label IDs across thread messages */
  labelIds: string[];
}

/** Group flat email list into threads by threadId, sorted by latest message date */
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
    // Sort messages by date ascending (oldest first) for participant ordering
    messages.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const latestMessage = messages[messages.length - 1];

    // Collect unique participant names in order of appearance
    const seen = new Set<string>();
    const participants: string[] = [];
    for (const msg of messages) {
      const name = msg.from.name || msg.from.email;
      if (!seen.has(name)) {
        seen.add(name);
        participants.push(name);
      }
    }

    // Merge labels across all messages
    const labelSet = new Set<string>();
    for (const msg of messages) {
      for (const l of msg.labelIds) labelSet.add(l);
    }

    threads.push({
      latestMessage,
      participants,
      messageCount: messages.length,
      hasUnread: messages.some((m) => !m.isRead),
      hasStarred: messages.some((m) => m.isStarred),
      labelIds: Array.from(labelSet),
    });
  }

  // Sort threads by latest message date descending
  threads.sort(
    (a, b) =>
      new Date(b.latestMessage.date).getTime() -
      new Date(a.latestMessage.date).getTime(),
  );

  return threads;
}
