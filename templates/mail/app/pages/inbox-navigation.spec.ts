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

function navigateActionSource(): string {
  return readFileSync(
    new URL("../../actions/navigate.ts", import.meta.url),
    "utf8",
  );
}

describe("Inbox navigation commands", () => {
  it("marks every unread message in a sidebar thread read when opening it", () => {
    const source = inboxSource();
    const sidebar = source.slice(
      source.indexOf("function ThreadListSidebar("),
      source.indexOf("const EMPTY_ACCOUNTS"),
    );

    expect(sidebar).toContain("const markThreadRead = useMarkThreadRead();");
    expect(sidebar).toContain("if (thread.hasUnread)");
    expect(sidebar).toContain(
      "markThreadRead.mutate({\n                    threadId: threadKey,\n                    accountEmail: email.accountEmail,\n                  });",
    );
    expect(sidebar).not.toContain("useMarkRead");
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
      'view === "inbox" && !searchQuery && !labelParam',
    );
    expect(emailList).toContain("{showPrioritySort && (");
    expect(emailList).toContain("!showPrioritySort &&");
    expect(emailList).toContain("jevAvailabilityError ? (");
    expect(emailList).toContain('variant="menu-item"');
    expect(source).toContain('toast.error(t("mail.sort.priorityFailed"))');
    expect(source).not.toContain("refetchOnWindowFocus: false");
  });

  it("syncs the active inbox partition into agent navigation state", () => {
    expect(navigationHookSource()).toContain("activeInboxTab?: string;");
    expect(navigationHookSource()).toContain("tab?: string;");
    expect(navigationHookSource()).toContain("filter?: string;");
    expect(navigationHookSource()).toContain("activeAccounts?: string[];");
    expect(navigationHookSource()).toContain("sort?: MailSortMode;");
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

  it("treats a needs_reauth account as incomplete coverage, not just error", () => {
    const source = inboxSource();

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
