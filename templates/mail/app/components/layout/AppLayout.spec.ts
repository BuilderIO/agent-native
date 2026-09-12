import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildLabelDisplayNames,
  labelTreeRows,
  reorderById,
} from "./AppLayout";

function appLayoutSource(): string {
  return readFileSync(new URL("./AppLayout.tsx", import.meta.url), "utf8");
}

describe("AppLayout inbox tab bar", () => {
  it("reads the whole-mailbox unread count off the synced label list, not loaded rows", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "const inboxSidebarUnreadCount = inboxThreads.data?.labels.find(",
    );
    expect(source).not.toContain('getInboxCount("unread")');
    expect(source).not.toContain("labelThreadCounts");
  });

  it("collapses the native rail while the per-app chat is open", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'import { usePerAppChatOpen } from "@agent-native/core/client/hooks";',
    );
    expect(source).toContain(
      "(sidebarPinned\n      ? sidebarCollapsed\n      : perAppChatOpen && !sidebarExpandedWhileChatOpen)",
    );
  });

  it("keeps the unpinned rail toggleable while per-app chat is open", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "const [sidebarExpandedWhileChatOpen, setSidebarExpandedWhileChatOpen] =",
    );
    expect(source).toContain("perAppChatOpen && !sidebarExpandedWhileChatOpen");
    expect(source).toContain(
      "sidebarPinned || (perAppChatOpen && showSidebar)",
    );
    expect(source).toContain(
      "setSidebarExpandedWhileChatOpen((value) => !value)",
    );
  });

  it("reserves desktop content space while the unpinned sidebar is open", () => {
    const source = appLayoutSource();

    expect(source).toContain("!isMobile &&\n              showSidebar &&");
    expect(source).toContain('!isMobile && sidebarOpen && "ps-[260px]"');
  });

  it("resolves every tab from the server response and links through inboxTabHref", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'import { inboxTabHref } from "@shared/inbox-threads";',
    );
    expect(source).toContain("const tabs = inboxThreads.data?.tabs ?? [];");
    expect(source).toContain("href: inboxTabHref(tab.id)");
    expect(source).toContain("tooltip: tab.query");
    expect(source).toContain("total: tab.total");
    expect(source).toContain("unread: tab.unread");
  });

  it("keeps the search restoration path", () => {
    const source = appLayoutSource();

    expect(source).toContain('params.set("tab", tab)');
    expect(source).toContain('params.set("filter", filter)');
  });

  it("uses the tab cog to persist and apply the combined inbox preference", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "const combineInbox = settings?.combineInbox === true;",
    );
    expect(source).toContain("updateSettings.mutate({ combineInbox: next });");
    expect(source).toContain("combinedInbox={combineInbox}");
    expect(source).toContain(
      "onCombinedInboxChange={handleCombinedInboxChange}",
    );
    expect(source).toContain("!isInboxScopedAppLabel(activeLabel)");
    expect(source).toContain("resolveDefaultMailHref({");
    expect(source).toContain("if (combineInbox) return [];");
    expect(source).toContain(
      '<Switch\n          id="combined-inbox-toggle"\n          checked={combinedInbox}\n          onCheckedChange={onCombinedInboxChange}',
    );
    expect(source).toContain('t("mail.tabSettings.combinedInbox")');
  });

  it("routes saved searches through the Gmail query path", () => {
    const source = appLayoutSource();

    expect(source).toContain("onSaveSearch={saveSearchAsFilter}");
    expect(source).toContain(
      "void navigate(`/inbox?filter=${encodeURIComponent(id)}`);",
    );
    expect(source).toContain("savedFilters: [...savedFilters, filter]");
    expect(source).toContain("savedFilters.length >= 20");
    expect(source).toContain("filtersLimitReached");
  });

  it("cycles top-bar tabs globally with the Tab key", () => {
    const source = appLayoutSource();

    expect(source).toContain("const cycleTab = useCallback(");
    expect(source).toContain("const activeIdx = topBarTabs.findIndex(");
    expect(source).toContain("(tab) => tab.isActive");
    expect(source).toContain('key: "Tab"');
    expect(source).toContain("shouldHandle: canCycleTab");
    expect(source).toContain("handler: () => cycleTab(false)");
    expect(source).toContain("handler: () => cycleTab(true)");
    expect(source).toContain("void navigate(topBarTabs[nextIdx].href);");
    expect(source).toContain("canCycleTab");
    expect(source).toContain("data-mail-tab-list");
  });

  it("no longer runs a client-side per-tab prefetch loop", () => {
    const source = appLayoutSource();

    expect(source).not.toContain("prefetchMailTabTargets");
    expect(source).not.toContain("getTabPrefetchTarget");
    expect(source).not.toContain('queryKey: ["email-prefetch"]');
  });

  it("builds pin mutations from the resolved visible pins", () => {
    const source = appLayoutSource();

    expect(source).toContain("const current = pinnedLabels;");
    expect(source).toContain("[pinnedLabels, updateSettings],");
  });

  it("drag-reorders pinned labels and saved filters through the same mechanism, each within its own group", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'type DragItem = { group: "label" | "filter"; id: string };',
    );
    expect(source).toContain("const canDrag = !!dragItemForTab;");
    expect(source).toContain('if (dragItem.group === "label") {');
    expect(source).toContain(
      "if (!pinnedLabels.includes(dragItem.id)) return;",
    );
    expect(source).toContain(
      "if (!savedFilters.some((filter) => filter.id === dragItem.id)) return;",
    );
    expect(source).toContain(
      "pinnedLabels: reorderById(\n          pinnedLabels,\n          (id) => id,\n          dragItem.id,\n          targetTab.pinnedId,\n          dropIndicator.side,\n        ),",
    );
    expect(source).toContain(
      "savedFilters: reorderById(\n          savedFilters,\n          (filter) => filter.id,\n          dragItem.id,\n          targetTab.filterId,\n          dropIndicator.side,\n        ),",
    );
    expect(source).toContain(
      "const targetTab = topBarTabs[dropIndicator.tabIndex];",
    );
  });

  it("mirrors the server-resolved label/filter tabs on mobile", () => {
    const source = appLayoutSource();

    expect(source).toContain("const mobileInboxTabs = dataTabs;");
    expect(source).toContain("{mobileInboxTabs.map((tab) => {");
    expect(source).toContain("const count = tab.unread;");
  });

  it("scopes both the tab bar and the label list to the selected accounts", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "useLabels(\n    activeAccounts.size > 0 ? [...activeAccounts] : undefined,\n  )",
    );
    expect(source).toContain("accountEmails: inboxAccountEmails,");
  });

  it("never shows a red list-labels banner — useLabels degrades on its own", () => {
    const source = appLayoutSource();

    expect(source).not.toContain('role="alert"');
    expect(source).not.toContain("mail.error.retrying");
    expect(source).toContain("data: labelsData");
  });

  it("shows a compact inline indicator only while the inbox is syncing", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "const inboxSyncing = inboxThreads.data?.syncing === true;",
    );
    expect(source).toContain("{inboxSyncing && (");
    expect(source).toContain('{t("mail.inbox.syncing")}');
  });

  it("reuses the existing Google reconnect UI for a needs_reauth account", () => {
    const source = appLayoutSource();

    expect(source).toContain('state === "needs_reauth"');
    expect(source).toContain(
      '{needsReauthAccount && <GoogleConnectBanner variant="banner" />}',
    );
  });

  it('fixes every dead `["labels"]` invalidation to the real action key', () => {
    const source = appLayoutSource();

    expect(source).not.toContain('queryKey: ["labels"]');
    expect(source).toContain("void invalidateInboxThreads(queryClient);");
  });

  // Repro: with no Google account connected, `view` for an unmatched URL
  // (e.g. /this-route-should-not-exist-xyz) was still "not settings" and
  // "not draft-queue", so the no-accounts takeover replaced `{children}` —
  // the routed NotFound page — with the Google-connect banner instead. The
  // page's <title> was correct (computed separately in $view.tsx's meta())
  // while the rendered body silently became the inbox shell.
  it("only shows the Google-connect takeover for a known mail view", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'import { isKnownMailView } from "@/routes/$view";',
    );
    expect(source).toContain(
      "isKnownMailView(view) &&\n          (googleConfigured || canOfferGoogleOAuthSetup) ? (\n            <GoogleConnectBanner",
    );
  });
});

describe("buildLabelDisplayNames", () => {
  it("disambiguates labels that share a short name", () => {
    const displayNames = buildLabelDisplayNames([
      { id: "top", name: "automated notifications", type: "user" },
      {
        id: "nested",
        name: "[Superhuman]/AI/Automated_notifications",
        type: "user",
      },
      { id: "pitch", name: "[Superhuman]/AI/Pitch", type: "user" },
    ]);

    expect(displayNames.get("top")).toBe("automated notifications");
    expect(displayNames.get("nested")).toBe(
      "[Superhuman]/AI/Automated notifications",
    );
    expect(displayNames.get("pitch")).toBe("Pitch");
  });
});

describe("labelTreeRows", () => {
  it("sorts by full path, computes nesting depth, and shows only the leaf name", () => {
    const rows = labelTreeRows([
      { id: "2-tasks", name: "2-tasks", type: "user" },
      { id: "kiwi", name: "1-clients/electric kiwi", type: "user" },
      { id: "clients", name: "1-clients", type: "user" },
      { id: "ab", name: "ab", type: "user" },
    ]);

    expect(rows.map((r) => r.label.id)).toEqual([
      "clients",
      "kiwi",
      "2-tasks",
      "ab",
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0, 0]);
    expect(rows.map((r) => r.displayName)).toEqual([
      "1-clients",
      "electric kiwi",
      "2-tasks",
      "ab",
    ]);
  });

  it("indents a child under where its missing parent would sort, without synthesizing the parent", () => {
    const rows = labelTreeRows([
      { id: "kiwi", name: "1-clients/electric kiwi", type: "user" },
      { id: "rakuten", name: "1-clients/rakuten", type: "user" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.depth === 1)).toBe(true);
    expect(rows.some((r) => r.label.id === "1-clients")).toBe(false);
  });

  it("sorts a/b directly after a, case-insensitively and naturally", () => {
    const rows = labelTreeRows([
      { id: "ab-id", name: "ab", type: "user" },
      { id: "a2-id", name: "a2", type: "user" },
      { id: "a-slash-b-id", name: "A/b", type: "user" },
      { id: "a-id", name: "a", type: "user" },
    ]);

    expect(rows.map((r) => r.label.id)).toEqual([
      "a-id",
      "a-slash-b-id",
      "a2-id",
      "ab-id",
    ]);
  });
});

describe("reorderById", () => {
  it("moves the dragged item before the target on a left drop", () => {
    expect(reorderById(["a", "b", "c"], (id) => id, "c", "a", "left")).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("moves the dragged item after the target on a right drop", () => {
    expect(reorderById(["a", "b", "c"], (id) => id, "a", "b", "right")).toEqual(
      ["b", "a", "c"],
    );
  });

  it("appends to the end when the target id is undefined (dropped outside this group)", () => {
    expect(
      reorderById(["a", "b", "c"], (id) => id, "a", undefined, "left"),
    ).toEqual(["b", "c", "a"]);
  });

  it("appends to the end when the target id isn't found in this list", () => {
    expect(
      reorderById(["a", "b", "c"], (id) => id, "a", "not-here", "left"),
    ).toEqual(["b", "c", "a"]);
  });

  it("returns a copy unchanged when the dragged id isn't in the list", () => {
    const items = ["a", "b", "c"];
    const result = reorderById(items, (id) => id, "missing", "b", "left");
    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it("works with objects via a custom id getter, e.g. saved filters", () => {
    const filters = [
      { id: "important", name: "Important" },
      { id: "github", name: "Github" },
      { id: "pitch", name: "Pitch" },
    ];

    const reordered = reorderById(
      filters,
      (f) => f.id,
      "github",
      "pitch",
      "right",
    );

    expect(reordered.map((f) => f.id)).toEqual([
      "important",
      "pitch",
      "github",
    ]);
  });
});
