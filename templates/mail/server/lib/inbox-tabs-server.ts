/**
 * Server-side inbox tab partitioning — the pure predicate `list-inbox-threads`
 * (and view-screen's inbox summary) build tabs, counts, and rows from, so a
 * tab's badge can never disagree with the rows it shows.
 *
 * Spec (Superhuman semantics):
 * - Tab order: Important, then one tab per pinned label (excluding
 *   "important"/"note-to-self" and any {@link COLLAPSIBLE_VIEW_IDS} system
 *   view id), then one tab per saved filter, then Other. `combineInbox`
 *   collapses all of that to a single "inbox" tab.
 * - A thread shows in EVERY custom (label/filter) tab whose query it
 *   matches — tabs are not mutually exclusive.
 * - A thread matching no custom tab falls to Important, unless it's
 *   automated (see `inbox-classify.ts`), in which case it falls to Other.
 */
import {
  ALL_INBOX_TAB_ID,
  IMPORTANT_TAB_ID,
  OTHER_TAB_ID,
  type InboxTabConfig,
  type InboxTabKind,
  type InboxThreadItem,
} from "@shared/inbox-threads.js";
import { emailMessageMatchesSearch } from "@shared/search.js";

// Mirrors app/lib/inbox-tabs.ts's COLLAPSIBLE_VIEW_IDS — system views render
// as their own collapsible sections, never as inbox triage tabs, so a stale
// pinned value for one of these must not become a tab here either.
const COLLAPSIBLE_VIEW_IDS = new Set([
  "unread",
  "starred",
  "sent",
  "drafts",
  "archive",
  "trash",
]);

export type ResolvedInboxTab = {
  id: string;
  kind: InboxTabKind;
  name: string;
  query?: string;
};

export function resolveInboxTabs(
  config: InboxTabConfig,
  labelNameById: Map<string, string>,
): ResolvedInboxTab[] {
  if (config.combineInbox) {
    return [{ id: ALL_INBOX_TAB_ID, kind: "inbox", name: "Inbox" }];
  }

  // "Important" and "Other" are fixed English source strings — the client
  // localizes built-in tab ids by `kind`, not by this `name`.
  const tabs: ResolvedInboxTab[] = [
    { id: IMPORTANT_TAB_ID, kind: "important", name: "Important" },
  ];

  for (const labelId of config.pinnedLabels) {
    if (labelId === IMPORTANT_TAB_ID || labelId === "note-to-self") continue;
    if (COLLAPSIBLE_VIEW_IDS.has(labelId)) continue;
    tabs.push({
      id: labelId,
      kind: "label",
      name:
        config.labelAliases[labelId] ?? labelNameById.get(labelId) ?? labelId,
      query: `label:"${labelId}"`,
    });
  }

  for (const filter of config.savedFilters) {
    tabs.push({
      id: filter.id,
      kind: "filter",
      name: filter.name,
      query: filter.query,
    });
  }

  tabs.push({ id: OTHER_TAB_ID, kind: "other", name: "Other" });
  return tabs;
}

/** Every tab id an item belongs to, in tab order. Never empty. */
export function inboxTabsForItem(
  item: InboxThreadItem,
  tabs: ResolvedInboxTab[],
): string[] {
  if (tabs.length === 1 && tabs[0].kind === "inbox") return [tabs[0].id];

  const matched = tabs
    .filter((tab) => tab.kind === "label" || tab.kind === "filter")
    .filter((tab) => emailMessageMatchesSearch(item, tab.query!))
    .map((tab) => tab.id);
  if (matched.length > 0) return matched;

  return [item.isAutomated ? OTHER_TAB_ID : IMPORTANT_TAB_ID];
}

/** Partitions `items` into every tab's member list (tab id -> items), in tab order. */
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

/** Resolves the requested tab id to a configured tab, falling back to the first tab. */
export function resolveActiveTabId(
  requested: string | undefined,
  tabs: ResolvedInboxTab[],
): string {
  const first = tabs[0]?.id ?? OTHER_TAB_ID;
  if (!requested) return first;
  return tabs.some((t) => t.id === requested) ? requested : first;
}
