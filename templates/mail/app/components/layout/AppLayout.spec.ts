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

function commandPaletteFocusSource(): string {
  return readFileSync(
    new URL("./use-command-palette-focus.ts", import.meta.url),
    "utf8",
  );
}

function mailGlobalCss(): string {
  return readFileSync(new URL("../../global.css", import.meta.url), "utf8");
}

describe("AppLayout inbox tab bar", () => {
  it("clears in-memory thread bodies when the session or mailbox scope changes", () => {
    const source = appLayoutSource();

    expect(source).toContain("setThreadCacheSessionScope(");
    expect(source).toContain("session?.authUserId");
    expect(source).toContain("setThreadCacheAccountScope(");
    expect(source).toContain("connected:");
    expect(source).toContain("selected:");
    expect(source).toContain("useEffect(() => () => clearThreadCache(), []);");
  });

  it("uses SQL inbox rows instead of the Gmail list API for connected accounts", () => {
    const source = appLayoutSource().replace(/\s+/g, " ");

    expect(source).toContain(
      'const useInboxThreadsForActionTargets = view === "inbox" && hasAccounts && activeSearchQuery === null && activeSavedFilterQuery === undefined && activeLabel === null',
    );
    expect(source).toContain(
      'enabled: isMailboxView && (view !== "inbox" || (hasAccounts ? !useInboxThreadsForActionTargets : googleStatusReady))',
    );
    expect(source).toContain(
      "const currentViewEmails = useInboxThreadsForActionTargets ? (inboxThreads.data?.items ?? []) : legacyCurrentViewEmails",
    );
  });

  it("scopes mailbox actions to the active search and label", () => {
    const source = appLayoutSource();

    expect(source).toContain("resolveInboxEmailQueryScope({");
    expect(source).toContain("isMailboxView ? shellQueryScope.emailView");
    expect(source).toContain("shellQueryScope.effectiveLabel");
  });

  it("keeps inbox action targets inside the active pinned-label or Other tab", () => {
    const source = appLayoutSource().replace(/\s+/g, " ");
    const targetStart = source.indexOf("const targetEmail = useMemo(() => {");
    const targetEnd = source.indexOf("const dismissEmail", targetStart);
    const targetSelection = source.slice(targetStart, targetEnd);

    expect(source).toContain("pinnedTriageLabels(pinnedLabels).includes(");
    expect(source).toContain("filterInboxTabEmails(");
    expect(source).toContain(
      "actionTargetTab === OTHER_INBOX_TAB_PARAM ? null : actionTargetTab",
    );
    expect(targetSelection).toContain("actionTargetEmails.find(");
    expect(targetSelection).toContain(
      "return actionTargetEmails[0] ?? undefined",
    );
    expect(targetSelection).not.toContain("currentViewEmails");
  });

  it("keys the shell mailbox query to the active saved filter", () => {
    const source = appLayoutSource();

    expect(source).toMatch(
      /const activeSavedFilterQuery = savedFilters\.find\(\s*\(filter\) => filter\.id === activeFilterId,\s*\)\?\.query;/,
    );
    expect(source).toContain(
      "activeSavedFilterQuery ?? activeSearchQuery ?? undefined",
    );
  });

  it("does not target previous-query rows while filters change", () => {
    const source = appLayoutSource();
    const hookSource = readFileSync(
      new URL("../../hooks/use-emails.ts", import.meta.url),
      "utf8",
    );

    expect(hookSource).toContain("isPlaceholderData: q.isPlaceholderData");
    const targetStart = source.indexOf("const actionTargetEmails = useMemo(");
    const targetEnd = source.indexOf("const reportSpam", targetStart);
    const targetSelection = source.slice(targetStart, targetEnd);

    expect(targetSelection).toContain("currentViewEmailsArePlaceholder");
    expect(targetSelection).toContain("filterInboxTabEmails(");
    expect(source).toContain("return actionTargetEmails[0] ?? undefined;");
  });

  it("keeps Mail navigation in a mobile drawer and supports desktop pinning", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "const [sidebarOpen, setSidebarOpen] = useState(false)",
    );
    expect(source).toContain(
      "const [sidebarPinned, setSidebarPinned] = useState(false)",
    );
    expect(source).toContain(
      'window.localStorage.getItem("mail-sidebar-pinned") === "true"',
    );
    expect(source).toContain("if (!sidebarPinPreferenceLoaded) return;");
    expect(source).toContain(
      'localStorage.setItem("mail-sidebar-pinned", "true")',
    );
    expect(source).toContain("open={sidebarOpen || isPinnedSidebarVisible}");
    expect(source).toContain("modal={!isPinnedSidebarVisible}");
    expect(source).toContain("<DialogTrigger asChild>");
    expect(source).toContain(
      "if (isPinnedSidebarVisible) event.preventDefault();",
    );
    expect(source).toMatch(
      /overlayClassName=\{\s*isPinnedSidebarVisible\s*\?\s*"hidden"\s*:\s*"bg-background\/20 backdrop-blur-none"\s*\}/,
    );
    expect(source).toContain("<DialogContent");
    expect(source).toContain("aria-modal={!isPinnedSidebarVisible}");
    expect(source).toContain('<DialogTitle className="sr-only">');
    expect(source).toContain("start-0 left-0 right-auto flex h-dvh w-[260px]");
    expect(source).toContain('t("mail.toolbar.pinSidebar")');
    expect(source).toContain('t("mail.toolbar.unpinSidebar")');
    expect(source).not.toContain("railNavItems");
    expect(source).not.toContain("showCollapsedSidebar");
  });

  it("does not reuse placeholder metadata from a previous account filter", () => {
    const source = appLayoutSource().replace(/\s+/g, " ");

    expect(source).toContain(
      "inboxOverview.data ?? (inboxThreads.isPlaceholderData ? undefined : inboxThreads.data)",
    );
  });

  it("opens the current agent chat in the full-page chat route", () => {
    const source = appLayoutSource();
    const chatRoute = readFileSync(
      new URL("../../routes/chat.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("onFullscreenRequest={(threadId?: string) =>");
    expect(source).toContain(
      '`/chat/${encodeURIComponent(threadId)}` : "/chat"',
    );
    expect(source).toContain("enabled={!isAgentChatRoute}");
    expect(source).toContain('pathname === "/chat"');
    expect(source).toContain('pathname.startsWith("/chat/")');
    expect(chatRoute).toContain("<AgentChatSurface");
    expect(chatRoute).toContain("browserTabId={TAB_ID}");
    expect(chatRoute).toContain("showTabBar");
  });

  it("accepts Shift when an international layout types the Search slash", () => {
    const source = appLayoutSource();

    expect(source).toContain('key: "/",\n      shift: "either",');
  });

  it("lets the thread own Escape when search is inactive", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'key: "Escape",\n      shouldHandle: () => Boolean(activeSearchQuery || searchFocused),',
    );
  });

  it("keeps global triage mutations scoped to the focused mailbox account", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      'accountEmail: targetEmail.accountEmail,\n    });\n    toast(t("mail.toasts.reportedSpam"))',
    );
    expect(source).toContain(
      "senderEmail: targetEmail.from.email,\n      accountEmail: targetEmail.accountEmail,",
    );
    expect(source).toContain(
      "muteThread.mutate({\n      threadId: tid,\n      accountEmail: targetEmail?.accountEmail,\n    });",
    );
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

  it("routes G+A to All Mail without changing the separate Archive route", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      '{ keys: ["g", "a"], handler: () => navigate("/all") },',
    );
    expect(source).toContain(
      '{ keys: ["g", "e"], handler: () => navigate("/archive") },',
    );
  });

  it("closes the captured popout drafts through the save-aware close-all path", () => {
    const source = appLayoutSource();

    expect(source).toContain("const savePromises = compose.closeAll(");
    expect(source).toContain("popoutDrafts.map((draft) => draft.id)");
    expect(source).toContain("compose.setActiveId(snapshot.id)");
    expect(source).toContain("compose.discard(snapshot.id)");
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

  it("scopes both the tab bar and the label list to the selected accounts", () => {
    const source = appLayoutSource();

    expect(source).toContain(
      "useLabels(\n    activeAccounts.size > 0 ? [...activeAccounts] : undefined,\n  )",
    );
    expect(source).toContain("accountEmails: inboxAccountEmails,");
  });

  it("exposes Filtered as a system view when its rule, label, or pin exists", () => {
    const source = appLayoutSource().replace(/\s+/g, " ");

    expect(source).toContain(
      "data: connectedLabelsData, accountErrors: connectedLabelErrors, isError: connectedLabelsFailed, } = useLabels();",
    );
    expect(source).toContain("connectedLabelsFailed ||");
    expect(source).toContain("Boolean(connectedLabelErrors?.length)");
    expect(source).toContain(
      "[connectedLabelsData ?? EMPTY_LABELS, labels].some(",
    );
    expect(source).toContain(
      "const hasFilteredPin = userPinnedLabels?.includes(AI_FILTER_LABEL) === true;",
    );
    expect(source).toContain(
      "hasFilteredRule || hasFilteredLabel || hasFilteredPin",
    );
    expect(source).toContain(
      'id: AI_FILTER_LABEL, labelKey: "mail.aiFilter.filteredMode"',
    );
    expect(source).toContain(
      "return pinnedLabels .filter((id) => systemViews.some((v) => v.id === id))",
    );
    expect(source).toContain("label: t(sysView.labelKey)");
    expect(source).toContain(
      "href: sysView.id === AI_FILTER_LABEL ? labelTabHref(AI_FILTER_LABEL)",
    );
    expect(source).toContain(
      '() => [...systemViewTabs, ...(view === "inbox" ? dataTabs : [])]',
    );
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

  it("only shows the Google-connect takeover for a known mail view", () => {
    const source = appLayoutSource().replace(/\s+/g, " ");

    expect(source).toContain(
      'import { isKnownMailView } from "@/routes/$view";',
    );
    expect(source).toContain(
      "isKnownMailView(view) && (googleConfigured || canOfferGoogleOAuthSetup) ? ( <GoogleConnectBanner",
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
