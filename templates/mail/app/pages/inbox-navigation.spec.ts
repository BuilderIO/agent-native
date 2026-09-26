import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function inboxSource(): string {
  return readFileSync(new URL("./InboxPage.tsx", import.meta.url), "utf8");
}

function emailListSource(): string {
  return readFileSync(
    new URL("../components/email/EmailList.tsx", import.meta.url),
    "utf8",
  );
}

function navigationHookSource(): string {
  return readFileSync(
    new URL("../hooks/use-navigation-state.ts", import.meta.url),
    "utf8",
  );
}

function viewScreenSource(): string {
  return readFileSync(
    new URL("../../actions/view-screen.ts", import.meta.url),
    "utf8",
  );
}

function emailsHandlerSource(): string {
  return readFileSync(
    new URL("../../server/handlers/emails.ts", import.meta.url),
    "utf8",
  );
}

function navigateActionSource(): string {
  return readFileSync(
    new URL("../../actions/navigate.ts", import.meta.url),
    "utf8",
  );
}

describe("Inbox navigation commands", () => {
  it("focuses compose drafts opened by MCP deep links", () => {
    const source = inboxSource();
    expect(source).toContain("navCommand.composeDraftId && !targetThread");
    expect(source).toContain("compose.setActiveId(navCommand.composeDraftId)");
    expect(source).toContain("FOCUS_COMPOSE_DRAFT_EVENT");
  });

  it("clears selection when switching inbox partitions", () => {
    const source = inboxSource();

    expect(source).toContain(
      "[view, activeLabel, activeInboxTab, activeFilterId]",
    );
  });

  it("routes a plain inbox to the All tab by default", () => {
    const source = inboxSource();

    expect(source).toContain("settingsLoading");
    expect(source).toContain("settingsError ||");
    expect(source).toContain("!settings ||");
    expect(source).toContain("resolveDefaultMailHref({");
    expect(source).toContain("showAllTab: settings?.showAllTab");
    expect(source).toContain("navigate(defaultHref, { replace: true })");
    expect(source).toContain(
      "const combineInbox = settings?.combineInbox === true;",
    );
    expect(source).toContain("combineInbox\n    )");
    expect(source).toContain("!combineInbox && isPinnedTab");
    expect(source).toContain("!combineInbox &&\n    activeInboxTab");
  });

  it("loads legacy custom-label inbox links from the whole mailbox", () => {
    const source = inboxSource();

    expect(source).toContain("const mailboxWideLabelTab =");
    expect(source).toContain('activeLabelRecord?.type !== "user"');
    expect(source).toContain(
      "const clientSliceTab =\n    !combineInbox && isPinnedTab && !searchQuery && !mailboxWideLabelTab;",
    );
    expect(source).toContain(
      'const emailView = activeSavedFilter\n    ? "inbox"',
    );
    // The inbox view itself now fetches through `useInboxThreads` instead —
    // this useEmails call stays disabled while on /inbox.
    expect(source).toContain(
      "useEmails(emailView, searchQuery, effectiveLabel, {\n    enabled: !isInboxView,\n  })",
    );
  });

  it("falls back to the useEmails search path when /inbox has a `q` param", () => {
    const source = inboxSource();

    // The store path (list-inbox-threads) has no notion of a free-text
    // search, so `isInboxView` (which gates rawEmails/pagination between the
    // store and useEmails) must turn off for a non-empty `q` — only the tab
    // bar's useInboxThreads stays keyed on the route alone.
    expect(source).toContain(
      'const isInboxView = view === "inbox" && !searchParams.get("q");',
    );
    expect(source).toContain('{ enabled: view === "inbox" },');
  });

  it("shows the row skeleton while the selected inbox tab loads", () => {
    const source = inboxSource();

    expect(source.replace(/\s+/g, " ")).toContain(
      "const isLoading = isInboxView ? inboxThreads.isLoading || inboxThreads.isPlaceholderData || inboxStillSyncingEmpty : emailsIsLoading;",
    );
  });

  it("lets Priority render a scored inbox page before later pages finish", () => {
    const page = inboxSource();
    const loadingStart = page.indexOf("const emailListLoading =");
    const loading = page.slice(
      loadingStart,
      page.indexOf("const emails = useMemo(", loadingStart),
    );

    expect(loading).not.toContain("inboxExtraPages");
    expect(emailListSource()).toContain(
      "priorityWindowEmails.length > cachedPriorityScores.size",
    );
  });

  it("navigates the inbox tab bar when an agent command sets `tab`", () => {
    const source = inboxSource();

    expect(source).toContain(
      'import { ALL_TAB_PARAM, inboxTabHref } from "@shared/inbox-threads";',
    );
    expect(source).toContain(
      "} else if (navCommand.tab) {\n      void navigate(inboxTabHref(navCommand.tab));\n    } else if (targetFilter) {",
    );
  });

  it("preserves Priority sort when Jev availability cannot be checked", () => {
    const source = inboxSource();
    const emailList = emailListSource();

    expect(source).toContain('localStorage.getItem("mail-sort-mode")');
    expect(source).toContain('localStorage.setItem("mail-sort-mode", mode)');
    expect(source).toContain(
      'jevAvailability.isError || jevConfigured ? "priority" : "newest"',
    );
    expect(source).toContain(
      'jevConfigured || (jevAvailability.isError && sortMode === "priority")',
    );
    expect(source).toContain("showPrioritySort={showPrioritySort}");
    expect(emailList).toContain(
      'showPrioritySort && view === "inbox" && !searchQuery && !labelParam',
    );
    expect(emailList).toContain("{jevConfigured && (");
    expect(emailList).toContain("{!jevConfigured && (");
    expect(emailList).toContain('variant="trigger"');
    expect(source).toContain('toast.error(t("mail.sort.priorityFailed"))');
    expect(source).not.toContain("refetchOnWindowFocus: false");
  });

  it("normalizes hidden combined-inbox triage routes", () => {
    const source = inboxSource();

    expect(source).toContain("const shouldNormalizeCombinedInboxRoute =");
    expect(source).toContain("activeLabelIsInboxScoped ||");
    expect(source).toContain('nextParams.delete("label")');
    expect(source).toContain('nextParams.delete("tab")');
    expect(source).toContain(
      "const effectiveLabel = shouldNormalizeCombinedInboxRoute",
    );
    expect(source).toContain(
      "if (shouldNormalizeCombinedInboxRoute) return filtered;",
    );
  });

  it("uses the saved filter query instead of a Gmail label query", () => {
    const source = inboxSource();

    expect(source).toContain(
      "const activeSavedFilter = settings?.savedFilters?.find(",
    );
    expect(source).toContain(
      'activeSavedFilter?.query ?? searchParams.get("q") ?? undefined',
    );
    expect(source).toContain("isSavedFilter: Boolean(activeSavedFilter)");
  });

  it("syncs the active inbox partition into agent navigation state", () => {
    expect(navigationHookSource()).toContain("activeInboxTab?: string;");
    expect(navigationHookSource()).toContain("tab?: string;");
    expect(navigationHookSource()).toContain("filter?: string;");
    expect(navigationHookSource()).toContain("activeAccounts?: string[];");
    expect(navigationHookSource()).toContain("sort?: MailSortMode;");
    // The inbox view reports the server-resolved tab id (falls back to the
    // raw URL param before the first response lands) so the agent sees the
    // actual active tab, including the default when the URL has none.
    expect(inboxSource()).toContain(
      'activeInboxTab:\n        view === "inbox"\n          ? (inboxThreads.data?.activeTabId ?? resolvedInboxTab)\n          : (activeInboxTab ?? undefined)',
    );
    expect(inboxSource()).toContain("filter: activeFilterId ?? undefined");
    expect(inboxSource()).toContain("const searchQ = searchQuery;");
    expect(inboxSource()).toContain(
      "activeAccounts.size > 0 ? Array.from(activeAccounts) : undefined",
    );
    expect(viewScreenSource()).toContain(
      "activeInboxTab: nav.activeInboxTab ?? null",
    );
    expect(viewScreenSource()).toContain('sort: nav.sort ?? "newest"');
    expect(viewScreenSource()).toContain("filter: nav.filter ?? null");
    expect(viewScreenSource()).toContain("nav.filter,");
    expect(navigateActionSource()).toContain("filter: z");
    expect(navigateActionSource()).toContain("nav.filter = args.filter");
    expect(navigateActionSource()).toContain('enum(["newest", "priority"])');
  });

  it("filters the view-screen snapshot using the resolved inbox tab", () => {
    const source = viewScreenSource();

    expect(source).toContain("activeInboxTab?: string");
    expect(source).toContain("activeAccounts?: string[]");
    expect(source).toContain('activeTab?.kind === "other"');
    expect(source).toContain("resolveActiveTabId(activeInboxTab, inboxTabs)");
    expect(source).toContain("augmentSelfSentLabels");
    expect(source).toContain("selectedAccountSet");
    expect(source).toContain("accountEmails:");
    expect(source).toContain("filterInboxTabEmails");
    expect(source).toContain("activeTriageTab");
    expect(source).toContain("triageLabels.includes(label)");
    expect(source).toContain("nav.activeInboxTab");
    expect(source).toContain("nav.activeAccounts");
  });

  it("keeps saved-filter threads out of the agent plain Inbox snapshot", () => {
    const source = viewScreenSource();

    expect(source).toContain(
      'effectiveView !== "inbox" || effectiveSearch || label',
    );
    expect(source).toContain(
      "const savedFilterThreads = savedFilterThreadIds(",
    );
    expect(source).toContain("!savedFilterThreads.has(inboxThreadKey(email))");
  });

  it("keeps saved-filter threads out of a plain inbox route", () => {
    const source = inboxSource();

    expect(source).toContain(
      'if (view === "inbox" && !searchQuery && savedFilterQueries.length > 0)',
    );
    expect(source).toContain(
      "const savedFilterThreads = savedFilterThreadIds(",
    );
    expect(source).toContain(
      "return filtered.filter((e) => !savedFilterThreads.has(inboxThreadKey(e)))",
    );
  });

  it("keeps ordinary pinned labels mailbox-wide in agent snapshots", () => {
    const source = viewScreenSource();

    expect(source).toContain("isInboxScopedAppLabel(label)");
  });

  it("filters full Gmail threads before collapsing the agent snapshot", () => {
    const source = viewScreenSource();

    expect(source).toContain(
      "const preparedMessages = messages.map((m: any) =>",
    );
    const normalizedSource = source
      .replace(/\s+/g, " ")
      .replace(/\s*([(),])\s*/g, "$1")
      .replace(/,([)\]])/g, "$1");
    expect(normalizedSource).toContain(
      "latestPerThread(applyActiveInboxTab(preparedMessages))",
    );
    expect(source).toContain(
      'threadFormat: needsSavedFilterParts ? "full" : "metadata"',
    );
  });

  it("hydrates Gmail parts for the inbox saved-filter partition", () => {
    const source = emailsHandlerSource();

    expect(source).toContain(
      'const isPlainInboxRequest = view === "inbox" && !q && !label;',
    );
    expect(source).toContain(
      "searchQueryNeedsAttachmentMetadata(filter.query)",
    );
    expect(source).toContain("threadFormat:");
  });

  it("disambiguates custom labels that share a system label name", () => {
    const source = inboxSource();

    expect(source).toContain('activeLabelRecord?.type !== "user"');
    expect(source).toContain("const labels = labelsData ?? EMPTY_LABELS;");
    expect(source).toContain("const activeLabelIsInboxScoped =");
  });

  it("treats a needs_reauth account as incomplete coverage, not just error", () => {
    const source = inboxSource();

    // A reconnect-needed account has unread rows we couldn't read either, so
    // it must suppress the false Inbox Zero the same as a sync error.
    expect(source).toContain(
      'account.state === "error" || account.state === "needs_reauth"',
    );
  });

  it("does not carry inbox account errors into placeholder tab data", () => {
    const source = inboxSource();

    expect(source).toContain(
      "if (inboxThreads.isPlaceholderData) return undefined;",
    );
    expect(source).toContain(
      "    inboxThreads.isPlaceholderData,\n    labelAccountErrors,\n  ]);",
    );
  });
});

describe("Inbox pagination", () => {
  it("keeps the empty-state pagination sentinel mounted for later matches", () => {
    const source = emailListSource();
    const emptyState = source.indexOf("  // Empty state");

    expect(emptyState).toBeGreaterThan(-1);
    expect(source.slice(0, emptyState)).toContain(
      "if (threads.length === 0 && hasNextPage)",
    );
    expect(source).toContain("isFetchNextPageError");
    const populatedState = source.indexOf("const virtualItems");
    expect(populatedState).toBeGreaterThan(-1);
    expect(source.slice(populatedState)).toContain("mail.error.tryAgain");
    expect(source).toContain("runPaginationRetry(fetchNextPage");
    expect(inboxSource()).toContain("shouldShowInboxZero");
    expect(inboxSource()).toContain("hasNextPage: Boolean(hasNextPage)");
  });

  it("pages the inbox view for real instead of a flat capped fetch", () => {
    const source = inboxSource();

    expect(source).toContain(
      "const inboxHasNextPage =\n    isInboxView && inboxThreads.data !== undefined\n      ? inboxThreadsHasNextPage(inboxItems.length, inboxThreads.data.total)\n      : false;",
    );
    expect(source).toContain(
      "const hasNextPage = isInboxView ? inboxHasNextPage : emailsHasNextPage;",
    );
    expect(source).toContain(
      "const fetchNextPage = isInboxView ? fetchInboxNextPage : emailsFetchNextPage;",
    );
    expect(source).toContain("setInboxExtraPageCount((count) => count + 1);");
    // Priority preloads its bounded evaluation window; other routes start
    // from the newly-active tab's page 0.
    expect(source).toContain("showPrioritySort,\n    resolvedInboxTab");
  });

  it("uses a contact-scoped search and bounded follow-up pages", () => {
    const source = inboxSource();

    expect(source).toContain('useEmails("all", normalizedDisplayEmail');
    expect(source).toContain("fetchNextPage");
    expect(source).toContain("contactPageFetchesRef");
    expect(source).toContain("contactGenerationRef");
    expect(source).toContain("isError: allEmailsError");
    expect(source).toContain("recentEmailsError={allEmailsError}");
    expect(source).toContain(
      "contactGenerationRef.current === contactGeneration",
    );
    expect(source).toContain("recentFromContact.length >= 4");
  });
});

describe("Inbox draft opening", () => {
  it("preserves Gmail attachment metadata without deleting the backing draft immediately", () => {
    const source = inboxSource();

    expect(source).toContain("attachments: email.attachments?.map");
    expect(source).toContain('source: "gmail"');
    expect(source).toContain("gmailMessageId: email.id");
    expect(source).toContain("gmailAttachmentId: attachment.id");
    expect(source).not.toContain("deleteDraft.mutate(email.id)");
  });
});

describe("Inbox load-more pagination error recovery", () => {
  it("retries a failed extra page instead of skipping it with a new offset", () => {
    const source = inboxSource();
    const hook = source.slice(
      source.indexOf("const fetchInboxNextPage = useCallback("),
      source.indexOf("const inboxAccountErrors = useMemo("),
    );

    expect(hook).toContain(
      "const lastPage = inboxExtraPages[inboxExtraPages.length - 1];",
    );
    expect(hook).toContain("if (lastPage?.isError)");
    expect(hook).toContain("return lastPage.refetch().then(() => undefined);");
    // Only reached once the failed-page retry branch above returns early.
    expect(hook).toContain("setInboxExtraPageCount((count) => count + 1);");
  });
});
