/**
 * Durable workflow topics are committed to the workflow outbox. The process
 * bus may wake the claimant, but it must never become a second dispatch path.
 */
export function isCertifiedDurableEventTopic(topic: string): boolean {
  return topic === "content" || topic.startsWith("content.");
}

export function assertEphemeralEventTopic(
  operation: "emit" | "subscribe",
  topic: string,
): void {
  if (!isCertifiedDurableEventTopic(topic)) return;
  throw new Error(
    `${operation}: "${topic}" is a certified durable workflow topic; use the workflow event log and shared claim engine`,
  );
}
