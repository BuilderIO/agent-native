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

  it("keeps the first-use Important default on a plain inbox route", () => {
    const source = inboxSource();

    expect(source).toContain("settingsLoading");
    expect(source).toContain("userPinnedLabels !== undefined");
    expect(source).toContain(
      'navigate("/inbox?label=important", { replace: true })',
    );
  });

  it("loads legacy custom-label inbox links from the whole mailbox", () => {
    const source = inboxSource();

    expect(source).toContain("const mailboxWideLabelTab =");
    expect(source).toContain('activeLabelRecord?.type !== "user"');
    expect(source).toContain(
      "const clientSliceTab = isPinnedTab && !searchQuery && !mailboxWideLabelTab;",
    );
    expect(source).toContain(
      'const emailView = activeSavedFilter\n    ? "all"',
    );
    expect(source).toContain(
      "useEmails(emailView, searchQuery, effectiveLabel)",
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
    expect(navigationHookSource()).toContain("filter?: string;");
    expect(navigationHookSource()).toContain("activeAccounts?: string[];");
    expect(inboxSource()).toContain(
      "activeInboxTab: activeInboxTab ?? undefined",
    );
    expect(inboxSource()).toContain("filter: activeFilterId ?? undefined");
    expect(inboxSource()).toContain("const searchQ = searchQuery;");
    expect(inboxSource()).toContain(
      "activeAccounts.size > 0 ? Array.from(activeAccounts) : undefined",
    );
    expect(viewScreenSource()).toContain(
      "activeInboxTab: nav.activeInboxTab ?? null",
    );
    expect(viewScreenSource()).toContain("filter: nav.filter ?? null");
    expect(viewScreenSource()).toContain("nav.filter,");
    expect(navigateActionSource()).toContain("filter: z");
    expect(navigateActionSource()).toContain("nav.filter = args.filter");
  });

  it("filters the view-screen snapshot to the active Other partition", () => {
    const source = viewScreenSource();

    expect(source).toContain("activeInboxTab?: string");
    expect(source).toContain("activeAccounts?: string[]");
    expect(source).toContain("activeInboxTab === OTHER_INBOX_TAB_PARAM");
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
    expect(source).toContain(
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
