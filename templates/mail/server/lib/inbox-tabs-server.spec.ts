import {
  ALL_TAB_PARAM,
  ALL_TAB_ID,
  IMPORTANT_TAB_ID,
  OTHER_TAB_ID,
  type InboxTabConfig,
  type InboxThreadItem,
} from "@shared/inbox-threads.js";
import { describe, expect, it } from "vitest";

import {
  partitionInboxItems,
  resolveActiveTabId,
  resolveInboxTabs,
} from "./inbox-tabs-server.js";

function item(overrides: Partial<InboxThreadItem>): InboxThreadItem {
  return {
    id: "m1",
    threadId: "t1",
    from: { name: "", email: "notifications@github.com" },
    to: [],
    subject: "",
    snippet: "",
    body: "",
    date: new Date().toISOString(),
    isRead: false,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
    messageCount: 1,
    unreadCount: 1,
    messageIds: ["m1"],
    isAutomated: false,
    ...overrides,
  };
}

describe("resolveInboxTabs", () => {
  it("orders Important, pinned labels, saved filters, then Other", () => {
    const config: InboxTabConfig = {
      pinnedLabels: ["important", "clients", "archive", "note-to-self"],
      savedFilters: [{ id: "f1", name: "Needs reply", query: "is:unread" }],
      labelAliases: { clients: "VIPs" },
      combineInbox: false,
      showAllTab: false,
    };
    const tabs = resolveInboxTabs(config, new Map([["clients", "Clients"]]));

    expect(tabs.map((t) => t.id)).toEqual([
      "important",
      "clients",
      "f1",
      "other",
    ]);
    expect(tabs.some((t) => t.id === "archive")).toBe(false);
    expect(tabs.find((t) => t.id === "clients")?.name).toBe("VIPs");
    expect(tabs.find((t) => t.id === "f1")?.query).toBe("is:unread");
  });

  it("collapses to one Inbox tab when combineInbox is on", () => {
    const config: InboxTabConfig = {
      pinnedLabels: ["important"],
      savedFilters: [],
      labelAliases: {},
      combineInbox: true,
    };
    expect(resolveInboxTabs(config, new Map())).toEqual([
      { id: "inbox", kind: "inbox", name: "Inbox" },
    ]);
  });

  it("shows All first by default and lets the preference hide it", () => {
    const config: InboxTabConfig = {
      pinnedLabels: ["important"],
      savedFilters: [],
      labelAliases: {},
      combineInbox: false,
    };
    const tabs = resolveInboxTabs(config, new Map());

    expect(tabs[0]).toEqual({ id: ALL_TAB_ID, kind: "all", name: "All" });
    expect(
      resolveInboxTabs({ ...config, showAllTab: false }, new Map())[0]?.id,
    ).toBe(IMPORTANT_TAB_ID);
  });
});

describe("partitionInboxItems", () => {
  const config: InboxTabConfig = {
    pinnedLabels: ["important", "automated notifications"],
    savedFilters: [{ id: "f1", name: "Pitches", query: "label:pitch" }],
    labelAliases: {},
    combineInbox: false,
    showAllTab: false,
  };
  const tabs = resolveInboxTabs(config, new Map());

  it("puts a thread in every matching custom (label/filter) tab", () => {
    const dual = item({
      id: "dual",
      labelIds: ["automated notifications", "pitch"],
    });
    const byTab = partitionInboxItems([dual], tabs);
    expect(byTab.get("automated notifications")).toContain(dual);
    expect(byTab.get("f1")).toContain(dual);
    expect(byTab.get("important")).not.toContain(dual);
    expect(byTab.get("other")).not.toContain(dual);
  });

  it("routes a non-automated unmatched thread to Important", () => {
    const unmatched = item({ isAutomated: false, labelIds: [] });
    const byTab = partitionInboxItems([unmatched], tabs);
    expect(byTab.get("important")).toContain(unmatched);
    expect(byTab.get("other")).not.toContain(unmatched);
  });

  it("routes an automated unmatched thread to Other", () => {
    const unmatched = item({ isAutomated: true, labelIds: [] });
    const byTab = partitionInboxItems([unmatched], tabs);
    expect(byTab.get("other")).toContain(unmatched);
    expect(byTab.get("important")).not.toContain(unmatched);
  });

  it("routes AI Important mail to Important even when automated", () => {
    const important = item({
      isAutomated: true,
      labelIds: ["agent-native-important"],
    });
    const byTab = partitionInboxItems([important], tabs);

    expect(byTab.get("important")).toContain(important);
    expect(byTab.get("other")).not.toContain(important);
  });

  it("keeps AI Important mail in Important alongside matching custom tabs", () => {
    const important = item({
      labelIds: ["agent-native-important", "pitch"],
    });
    const byTab = partitionInboxItems([important], tabs);

    expect(byTab.get("important")).toContain(important);
    expect(byTab.get("f1")).toContain(important);
  });

  it("matches label: queries against the hyphenated Gmail search form", () => {
    const notif = item({ labelIds: ["automated notifications"] });
    const byTab = partitionInboxItems([notif], tabs);
    expect(byTab.get("automated notifications")).toContain(notif);
  });

  it("includes every inbox thread in All without changing its other tabs", () => {
    const allTabs = resolveInboxTabs(
      { ...config, showAllTab: true },
      new Map(),
    );
    const custom = item({ id: "custom", labelIds: ["pitch"] });
    const automated = item({ id: "automated", isAutomated: true });
    const byTab = partitionInboxItems([custom, automated], allTabs);

    expect(byTab.get(ALL_TAB_ID)).toEqual([custom, automated]);
    expect(byTab.get("f1")).toContain(custom);
    expect(byTab.get("other")).toContain(automated);
  });
});

describe("resolveActiveTabId", () => {
  const config: InboxTabConfig = {
    pinnedLabels: ["important"],
    savedFilters: [{ id: "f1", name: "Pitches", query: "label:pitch" }],
    labelAliases: {},
    combineInbox: false,
    showAllTab: false,
  };
  const tabs = resolveInboxTabs(config, new Map());

  it("resolves a known tab id as-is", () => {
    expect(resolveActiveTabId("f1", tabs)).toBe("f1");
    expect(resolveActiveTabId("other", tabs)).toBe("other");
  });

  it("falls back to the first tab when omitted or unknown", () => {
    expect(resolveActiveTabId(undefined, tabs)).toBe("important");
    expect(resolveActiveTabId("not-a-real-tab", tabs)).toBe("important");
  });

  it("resolves the public All tab parameter to its built-in tab id", () => {
    const allTabs = resolveInboxTabs(
      { ...config, showAllTab: true },
      new Map(),
    );
    expect(resolveActiveTabId(ALL_TAB_PARAM, allTabs)).toBe(ALL_TAB_ID);
  });

  it("does not reserve a saved-filter id named all", () => {
    const tabsWithAllFilter = resolveInboxTabs(
      {
        ...config,
        savedFilters: [{ id: "all", name: "All matches", query: "is:unread" }],
      },
      new Map(),
    );

    expect(resolveActiveTabId("all", tabsWithAllFilter)).toBe("all");
  });

  it("reserves built-in tab ids from pinned labels and saved filters", () => {
    const tabs = resolveInboxTabs(
      {
        ...config,
        showAllTab: true,
        pinnedLabels: [ALL_TAB_ID, OTHER_TAB_ID],
        savedFilters: [
          { id: ALL_TAB_ID, name: "All matches", query: "is:unread" },
          { id: OTHER_TAB_ID, name: "Other matches", query: "is:unread" },
        ],
      },
      new Map(),
    );

    expect(tabs.filter((tab) => tab.id === ALL_TAB_ID)).toMatchObject([
      { kind: "all" },
    ]);
    expect(tabs.filter((tab) => tab.id === OTHER_TAB_ID)).toMatchObject([
      { kind: "other" },
    ]);
    expect(resolveActiveTabId(ALL_TAB_ID, tabs)).toBe(ALL_TAB_ID);
  });

  it("lands on All by default even when pinned labels and saved filters exist", () => {
    const configWithPinnedLabels: InboxTabConfig = {
      pinnedLabels: ["important", "clients", "2-tasks"],
      savedFilters: [{ id: "f1", name: "Needs reply", query: "is:unread" }],
      labelAliases: {},
      combineInbox: false,
    };
    const tabsWithPinnedLabels = resolveInboxTabs(
      configWithPinnedLabels,
      new Map(),
    );

    expect(tabsWithPinnedLabels[0]?.id).toBe(ALL_TAB_ID);
    expect(resolveActiveTabId(undefined, tabsWithPinnedLabels)).toBe(
      ALL_TAB_ID,
    );
  });
});
