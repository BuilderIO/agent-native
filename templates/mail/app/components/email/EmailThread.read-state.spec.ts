import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("app/components/email/EmailThread.tsx", "utf8");

describe("EmailThread read state action", () => {
  it("shows the current read-state toggle in the thread toolbar", () => {
    expect(source).toContain("setCurrentEmailReadState(!email.isRead)");
    expect(source).toContain("keepUnreadThreadRef.current !== threadId");
    expect(source).toContain("keepUnreadThreadRef.current = undefined");
    expect(source).toContain("clearTimeout(autoReadTimerRef.current)");
    expect(source).toContain("failedAutoReadThreadRef.current = id");
    expect(source).toContain('? "mail.actions.markUnread"');
    expect(source).toContain(': "mail.actions.markRead"');
    expect(source).toContain('<IconMail className="h-4 w-4" />');
    expect(source).toContain('<IconMailOpened className="h-4 w-4" />');
  });
});

describe("EmailThread trash shortcuts", () => {
  it("keeps both the Gmail and Superhuman aliases on the same action", () => {
    expect(source).toContain('{ key: "d", handler: handleTrash }');
    expect(source).toContain(
      '{ key: "#", shift: "either", handler: handleTrash }',
    );
    expect(source).toContain('t("mail.actions.moveToTrash")} (D / #)');
  });

  it("shows importance feedback in Inbox and the Filtered review view", () => {
    expect(source).toContain(
      'email && (view === "inbox" || isAiFiltered) && (',
    );
    expect(source).toContain(
      'email && view !== "inbox" && view !== "trash" && (',
    );
    expect(source).toContain('<IconTrash className="h-4 w-4" />');
  });
});

describe("EmailThread labels", () => {
  it("resolves label ids through the account-scoped label map", () => {
    expect(source).toContain("const { data: labels = [] } = useLabels(");
    expect(source).toContain("labelNames.get(labelId)");
    expect(source).toContain("mailLabelDisplayName(");
  });
});

describe("EmailThread removal undo", () => {
  it("passes the thread key to both reversal mutations", () => {
    expect(source).toMatch(
      /unarchiveEmail\.mutate\(\{[\s\S]*threadId: t\.threadId \|\| t\.id/,
    );
    expect(source).toMatch(
      /untrashEmail\.mutate\(\{[\s\S]*threadId: t\.threadId \|\| t\.id/,
    );
  });
});

describe("EmailThread control accessibility", () => {
  it("names icon-only toolbar, message, attachment, and search controls", () => {
    for (const label of [
      'aria-label={t("mail.thread.back")}',
      'aria-label={t("mail.actions.archive")}',
      'aria-label={t("mail.actions.moveToTrash")}',
      'aria-label={t("mail.thread.previousConversation")}',
      'aria-label={t("mail.thread.nextConversation")}',
      'aria-label={t("mail.thread.closeDetails")}',
      'aria-label={t("mail.compose.reply")}',
      'aria-label={t("mail.mobileActions.replyAll")}',
      'aria-label={t("mail.compose.forward")}',
      'aria-label={t("mail.thread.downloadAll")}',
      'aria-label={t("mail.thread.previousMatch")}',
      'aria-label={t("mail.thread.nextMatch")}',
      'aria-label={t("mail.thread.closeSearch")}',
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain(
      'aria-label={t("mail.thread.searchConversationLabel")}',
    );
    expect(source).not.toContain("<TooltipContent>Back (Esc)</TooltipContent>");
    expect(source).not.toContain("<TooltipContent>Reply</TooltipContent>");
    expect(source).not.toContain("<TooltipContent>Forward</TooltipContent>");
    expect(source).not.toContain(
      "<TooltipContent>Previous match (Shift+Enter)</TooltipContent>",
    );
    expect(source).not.toContain(
      "<TooltipContent>Next match (Enter)</TooltipContent>",
    );
    expect(source).not.toContain(
      "<TooltipContent>Close (Esc)</TooltipContent>",
    );
  });
});
