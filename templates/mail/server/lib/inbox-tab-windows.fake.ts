import { AI_IMPORTANT_LABEL } from "@shared/ai-priority.js";
import type { InboxThreadItem } from "@shared/inbox-threads.js";

import type { InboxTabWindows, InboxThreadRow } from "./inbox-store.js";
import {
  partitionInboxItems,
  type ResolvedInboxTab,
} from "./inbox-tabs-server.js";

/**
 * Test double for `readInboxTabWindows`: the same windows computed in memory
 * from rows a spec already holds. A row counts as AI-important when one of its
 * raw Gmail label ids is in `aiLabelIdsByAccount`, as the SQL decides it, so
 * the action's label wiring is exercised. Equivalence with the SQL is asserted
 * by inbox-store.tab-windows-pglite.spec.ts.
 */
export function inMemoryTabWindows(
  rows: InboxThreadRow[],
  params: {
    tabs: readonly ResolvedInboxTab[];
    aiLabelIdsByAccount: ReadonlyMap<string, readonly string[]>;
    pageTabId: string;
    pageOffset: number;
    pageLimit: number;
    pageUnreadOnly: boolean;
    previewLimit: number;
  },
  toItem: (row: InboxThreadRow) => InboxThreadItem,
): InboxTabWindows {
  const rowByItem = new Map<InboxThreadItem, InboxThreadRow>();
  const items = rows.map((row) => {
    const item = toItem(row);
    const aiIds = params.aiLabelIdsByAccount.get(row.accountEmail) ?? [];
    const aiImportant = row.labelIds.some((id) => aiIds.includes(id));
    const shaped = aiImportant
      ? { ...item, labelIds: [...item.labelIds, AI_IMPORTANT_LABEL] }
      : item;
    rowByItem.set(shaped, row);
    return shaped;
  });
  const byTab = partitionInboxItems(items, [...params.tabs]);
  const rowsOf = (tabId: string) =>
    (byTab.get(tabId) ?? []).map((item) => rowByItem.get(item)!);
  const unreadOf = (members: InboxThreadRow[]) =>
    members.filter((row) => (row.unreadCount ?? 0) > 0);

  const active = rowsOf(params.pageTabId);
  const pool = params.pageUnreadOnly ? unreadOf(active) : active;
  return {
    counts: new Map(
      params.tabs.map((tab) => {
        const members = rowsOf(tab.id);
        return [
          tab.id,
          { total: members.length, unread: unreadOf(members).length },
        ];
      }),
    ),
    previews: new Map(
      params.tabs.map((tab) => [
        tab.id,
        rowsOf(tab.id).slice(0, params.previewLimit),
      ]),
    ),
    page: pool.slice(params.pageOffset, params.pageOffset + params.pageLimit),
  };
}
