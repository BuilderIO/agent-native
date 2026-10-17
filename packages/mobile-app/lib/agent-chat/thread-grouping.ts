import type { ChatThreadSummary } from "./types";

export function threadKey(thread: ChatThreadSummary): string {
  return `${thread.baseUrl ?? ""}:${thread.id}`;
}

export type ThreadHistoryRow =
  | { type: "header"; appName: string; appIcon: string; key: string }
  | { type: "thread"; thread: ChatThreadSummary; key: string };

export function groupThreadsByApp(
  threads: ChatThreadSummary[],
): ThreadHistoryRow[] {
  const order: string[] = [];
  const byApp = new Map<string, ChatThreadSummary[]>();
  for (const thread of threads) {
    const appKey = thread.appId ?? thread.baseUrl ?? "chat";
    if (!byApp.has(appKey)) {
      byApp.set(appKey, []);
      order.push(appKey);
    }
    byApp.get(appKey)!.push(thread);
  }
  const rows: ThreadHistoryRow[] = [];
  for (const appKey of order) {
    const appThreads = byApp.get(appKey)!;
    const first = appThreads[0]!;
    rows.push({
      type: "header",
      appName: first.appName ?? "Chat",
      appIcon: first.appIcon ?? "MessageSquare",
      key: `header-${appKey}`,
    });
    for (const thread of appThreads) {
      rows.push({ type: "thread", thread, key: threadKey(thread) });
    }
  }
  return rows;
}
