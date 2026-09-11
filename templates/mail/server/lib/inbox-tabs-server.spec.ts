import type { InboxTabConfig, InboxThreadItem } from "@shared/inbox-threads.js";
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
    };
    const tabs = resolveInboxTabs(config, new Map([["clients", "Clients"]]));

    expect(tabs.map((t) => t.id)).toEqual([
      "important",
      "clients",
      "f1",
      "other",
    ]);
    // "archive" is a collapsible system view, not a triage tab; note-to-self
    // is excluded from the tab list even when pinned.
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
});

describe("partitionInboxItems", () => {
  const config: InboxTabConfig = {
    pinnedLabels: ["important", "automated notifications"],
    savedFilters: [{ id: "f1", name: "Pitches", query: "label:pitch" }],
    labelAliases: {},
    combineInbox: false,
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
    // Matched a custom tab, so it does NOT fall into Important/Other too.
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

  it("matches label: queries against the hyphenated Gmail search form", () => {
    const notif = item({ labelIds: ["automated notifications"] });
    const byTab = partitionInboxItems([notif], tabs);
    expect(byTab.get("automated notifications")).toContain(notif);
  });
});

describe("resolveActiveTabId", () => {
  const config: InboxTabConfig = {
    pinnedLabels: ["important"],
    savedFilters: [{ id: "f1", name: "Pitches", query: "label:pitch" }],
    labelAliases: {},
    combineInbox: false,
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
});
