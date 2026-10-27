const ASK_PATH = "/ask";

/** `/ask` is the blank new-chat page; `/ask/<threadId>` is one saved thread. */
export function isAnalyticsAskPath(pathname: string): boolean {
  return pathname === ASK_PATH || pathname.startsWith(`${ASK_PATH}/`);
}

/**
 * Thread id from `/ask/<threadId>`, or null on the blank `/ask` page. Decodes
 * the segment the way React Router's useParams does, so the sidebar's active id
 * matches the route's id. A malformed escape stays literal rather than throwing.
 */
export function analyticsAskThreadIdFromPath(pathname: string): string | null {
  const segment = /^\/ask\/([^/]+)\/?$/.exec(pathname)?.[1];
  return segment === undefined ? null : decodeThreadSegment(segment);
}

function decodeThreadSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function analyticsAskThreadPath(threadId: string | null): string {
  return threadId ? `${ASK_PATH}/${encodeURIComponent(threadId)}` : ASK_PATH;
}
