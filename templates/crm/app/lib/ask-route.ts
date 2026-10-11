const ASK_PATH = "/ask";

/** `/ask` is the blank new-chat page; `/ask/<threadId>` is one saved thread. */
export function isCrmAskPath(pathname: string): boolean {
  return pathname === ASK_PATH || pathname.startsWith(`${ASK_PATH}/`);
}

export function crmAskThreadPath(threadId: string | null): string {
  return threadId ? `${ASK_PATH}/${encodeURIComponent(threadId)}` : ASK_PATH;
}
