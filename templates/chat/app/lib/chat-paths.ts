// Production builds compile this to `false`, so `/home` stays the chat entry
// there and the Home page only exists under `pnpm dev`.
export const SHOW_HOME_PAGE = import.meta.env.DEV;

export const HOME_PATH = "/home";
export const NEW_CHAT_PATH = "/chat";

export function chatThreadPath(threadId: string | null | undefined): string {
  return threadId
    ? `${NEW_CHAT_PATH}/${encodeURIComponent(threadId)}`
    : NEW_CHAT_PATH;
}

export function isChatPathname(pathname: string): boolean {
  if (pathname === NEW_CHAT_PATH || pathname.startsWith(`${NEW_CHAT_PATH}/`)) {
    return true;
  }
  return !SHOW_HOME_PAGE && pathname === HOME_PATH;
}

export function threadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
    // coercion-ok: a malformed percent-encoding is not a thread id, so the path has no thread.
  } catch {
    return null;
  }
}

/** Router state that carries a prompt typed elsewhere into the chat it opens. */
export interface ChatRouteState {
  initialMessage: string;
}

export function initialMessageFromState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const message = (state as Partial<ChatRouteState>).initialMessage;
  return typeof message === "string" && message.trim() ? message : null;
}
