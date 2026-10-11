const CHAT_PATH = "/chat";

// `/chat/<threadId>` must count as the chat page everywhere `/chat` does
// (layout, session bypass, handoff), or the shell flips when a submit moves the URL.
export function isPlanChatPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === CHAT_PATH || normalized.startsWith(`${CHAT_PATH}/`);
}

export function planChatThreadPath(threadId: string | null): string {
  return threadId ? `${CHAT_PATH}/${encodeURIComponent(threadId)}` : CHAT_PATH;
}
