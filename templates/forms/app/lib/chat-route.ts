const ASK_PATH = "/ask";

// `/ask/<threadId>` must count as the chat page everywhere `/ask` does: the
// layout picks a different shell for it, so a mismatch remounts the chat.
export function isFormsAskPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === ASK_PATH || normalized.startsWith(`${ASK_PATH}/`);
}

export function formsAskThreadPath(threadId: string | null): string {
  return threadId ? `${ASK_PATH}/${encodeURIComponent(threadId)}` : ASK_PATH;
}
