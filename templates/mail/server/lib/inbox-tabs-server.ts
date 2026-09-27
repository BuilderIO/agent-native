import { AI_IMPORTANT_LABEL } from "@shared/ai-priority.js";
import { mailLabelsInclude } from "@shared/gmail-labels.js";
import {
  ALL_TAB_ID,
  ALL_INBOX_TAB_ID,
  IMPORTANT_TAB_ID,
  OTHER_TAB_ID,
  type InboxTabConfig,
  type InboxTabKind,
  type InboxThreadItem,
} from "@shared/inbox-threads.js";
import { emailMessageMatchesSearch } from "@shared/search.js";
import type { EmailMessage } from "@shared/types.js";

import { classifyAutomated } from "./inbox-classify.js";

const COLLAPSIBLE_VIEW_IDS = new Set([
  "unread",
  "starred",
  "sent",
  "drafts",
  "archive",
  "trash",
]);

const LOCAL_CATEGORY_TO_GMAIL_LABEL: Record<string, string> = {
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

export type ResolvedInboxTab = {
  id: string;
  kind: InboxTabKind;
  name: string;
  query?: string;
};

export function buildLocalInboxItems(
  emails: EmailMessage[],
): InboxThreadItem[] {
  const byThread = new Map<string, EmailMessage[]>();
  for (const email of emails) {
    if (email.isArchived || email.isTrashed || email.isDraft) continue;
    const key = email.threadId || email.id;
    const list = byThread.get(key);
    if (list) list.push(email);
    else byThread.set(key, [email]);
  }

  const items = [...byThread.values()]
    .filter((messages) => messages.some((message) => !message.isSent))
    .map((messages): InboxThreadItem => {
      const latest = messages.reduce((a, b) =>
        new Date(b.date).getTime() > new Date(a.date).getTime() ? b : a,
      );
      const labelIds = [...new Set(messages.flatMap((m) => m.labelIds))];
      const isAutomated = classifyAutomated({
        headers: [],
        labelIds: labelIds.map((l) => LOCAL_CATEGORY_TO_GMAIL_LABEL[l] ?? l),
        fromEmail: latest.from?.email ?? "",
      });
      return {
        ...latest,
        labelIds,
        messageCount: messages.length,
        unreadCount: messages.filter((m) => !m.isRead).length,
        messageIds: messages.map((m) => m.id),
        isAutomated,
      };
    });

  return items.sort(
    (a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime() ||
      b.id.localeCompare(a.id),
  );
}

export function resolveInboxTabs(
  config: InboxTabConfig,
  labelNameById: Map<string, string>,
): ResolvedInboxTab[] {
  if (config.combineInbox) {
    return [{ id: ALL_INBOX_TAB_ID, kind: "inbox", name: "Inbox" }];
  }

  const tabs: ResolvedInboxTab[] = [
    ...(config.showAllTab === false
      ? []
      : [{ id: ALL_TAB_ID, kind: "all" as const, name: "All" }]),
    { id: IMPORTANT_TAB_ID, kind: "important", name: "Important" },
  ];
  const tabIds = new Set([ALL_TAB_ID, IMPORTANT_TAB_ID, OTHER_TAB_ID]);

  for (const labelId of config.pinnedLabels) {
    if (labelId === IMPORTANT_TAB_ID || labelId === "note-to-self") continue;
    if (COLLAPSIBLE_VIEW_IDS.has(labelId)) continue;
    if (tabIds.has(labelId)) continue;
    tabs.push({
      id: labelId,
      kind: "label",
      name:
        config.labelAliases[labelId] ?? labelNameById.get(labelId) ?? labelId,
      query: `label:"${labelId}"`,
    });
    tabIds.add(labelId);
  }

  for (const filter of config.savedFilters) {
    if (tabIds.has(filter.id)) continue;
    tabs.push({
      id: filter.id,
      kind: "filter",
      name: filter.name,
      query: filter.query,
    });
    tabIds.add(filter.id);
  }

  tabs.push({ id: OTHER_TAB_ID, kind: "other", name: "Other" });
  return tabs;
}

export function inboxTabsForItem(
  item: InboxThreadItem,
  tabs: ResolvedInboxTab[],
): string[] {
  if (tabs.length === 1 && tabs[0].kind === "inbox") return [tabs[0].id];

  const allTab = tabs.find((tab) => tab.kind === "all");
  const isAiImportant = mailLabelsInclude(item.labelIds, AI_IMPORTANT_LABEL);

  const matched = tabs
    .filter((tab) => tab.kind === "label" || tab.kind === "filter")
    .filter((tab) => emailMessageMatchesSearch(item, tab.query!))
    .map((tab) => tab.id);
  if (isAiImportant) matched.unshift(IMPORTANT_TAB_ID);
  if (matched.length > 0) {
    if (allTab) matched.unshift(allTab.id);
    return matched;
  }

  return [
    ...(allTab ? [allTab.id] : []),
    item.isAutomated ? OTHER_TAB_ID : IMPORTANT_TAB_ID,
  ];
}

export function partitionInboxItems(
  items: InboxThreadItem[],
  tabs: ResolvedInboxTab[],
): Map<string, InboxThreadItem[]> {
  const byTab = new Map<string, InboxThreadItem[]>(tabs.map((t) => [t.id, []]));
  for (const item of items) {
    for (const tabId of inboxTabsForItem(item, tabs)) {
      byTab.get(tabId)?.push(item);
    }
  }
  return byTab;
}

export function resolveActiveTabId(
  requested: string | undefined,
  tabs: ResolvedInboxTab[],
): string {
  const first = tabs[0]?.id ?? OTHER_TAB_ID;
  if (!requested) return first;
  return tabs.some((t) => t.id === requested) ? requested : first;
}
