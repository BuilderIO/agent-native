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

describe("Inbox navigation commands", () => {
  it("focuses compose drafts opened by MCP deep links", () => {
    const source = inboxSource();
    expect(source).toContain("navCommand.composeDraftId && !targetThread");
    expect(source).toContain("compose.setActiveId(navCommand.composeDraftId)");
    expect(source).toContain("FOCUS_COMPOSE_DRAFT_EVENT");
  });

  it("clears selection when switching inbox partitions", () => {
    const source = inboxSource();

    expect(source).toContain("[view, activeLabel, activeInboxTab]");
  });

  it("syncs the active inbox partition into agent navigation state", () => {
    expect(navigationHookSource()).toContain("activeInboxTab?: string;");
    expect(navigationHookSource()).toContain("activeAccounts?: string[];");
    expect(inboxSource()).toContain(
      "activeInboxTab: activeInboxTab ?? undefined",
    );
    expect(inboxSource()).toContain(
      "activeAccounts.size > 0 ? Array.from(activeAccounts) : undefined",
    );
    expect(viewScreenSource()).toContain(
      "activeInboxTab: nav.activeInboxTab ?? null",
    );
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
    expect(source).toContain("nav.activeInboxTab");
    expect(source).toContain("nav.activeAccounts");
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
