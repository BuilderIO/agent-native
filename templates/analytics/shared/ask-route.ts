const ASK_PATH = "/ask";

/** `/ask` is the blank new-chat page; `/ask/<threadId>` is one saved thread. */
export function isAnalyticsAskPath(pathname: string): boolean {
  return pathname === ASK_PATH || pathname.startsWith(`${ASK_PATH}/`);
}

/**
 * Thread id from `/ask/<threadId>`, or null on the blank `/ask` page. Thread
 * ids are URL-safe (UUIDs or `thread-*`), so the raw segment is the id.
 */
export function analyticsAskThreadIdFromPath(pathname: string): string | null {
  const segment = /^\/ask\/([^/]+)\/?$/.exec(pathname)?.[1];
  return segment || null;
}

export function analyticsAskThreadPath(threadId: string | null): string {
  return threadId ? `${ASK_PATH}/${encodeURIComponent(threadId)}` : ASK_PATH;
}
