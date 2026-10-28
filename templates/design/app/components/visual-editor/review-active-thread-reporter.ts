/**
 * Reports a reporter's open thread, or null when it has none. Every
 * `ReviewCanvasPins` mounted at once reports through the same callback, so the
 * reporter id says whose thread a report is about.
 */
export type ReviewActiveThreadReporter = (
  threadId: string | null,
  reporterId: string,
) => void;

/**
 * Publishes the latest thread any reporter still has open. A reporter closing
 * or unmounting withdraws only its own report, so it cannot clear a thread that
 * another reporter opened after it.
 */
export function createReviewActiveThreadReporter(
  publish: (threadId: string | null) => void,
): ReviewActiveThreadReporter {
  // A Map iterates in insertion order, and a re-report moves to the end.
  const openByReporter = new Map<string, string>();
  return (threadId, reporterId) => {
    openByReporter.delete(reporterId);
    if (threadId !== null) openByReporter.set(reporterId, threadId);
    const latest = Array.from(openByReporter.values()).pop();
    publish(latest === undefined ? null : latest);
  };
}
