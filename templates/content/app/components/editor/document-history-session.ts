export const HISTORY_IDLE_MS = 5 * 60 * 1000;

export function createHistorySession(
  createId: () => string = () => crypto.randomUUID(),
) {
  let pageId: string | undefined;
  let sessionId: string | undefined;
  let lastActivity: number | undefined;
  return {
    activity(documentId: string, now = Date.now()): string {
      if (
        pageId !== documentId ||
        !sessionId ||
        (lastActivity !== undefined && now - lastActivity >= HISTORY_IDLE_MS)
      ) {
        pageId = documentId;
        sessionId = createId();
      }
      lastActivity = now;
      return sessionId;
    },
    reset() {
      sessionId = undefined;
      lastActivity = undefined;
    },
  };
}
