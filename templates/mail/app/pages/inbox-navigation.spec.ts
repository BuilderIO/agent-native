import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function inboxSource(): string {
  return readFileSync(new URL("./InboxPage.tsx", import.meta.url), "utf8");
}

describe("Inbox navigation commands", () => {
  it("focuses compose drafts opened by MCP deep links", () => {
    const source = inboxSource();
    expect(source).toContain("navCommand.composeDraftId && !targetThread");
    expect(source).toContain("compose.setActiveId(navCommand.composeDraftId)");
    expect(source).toContain("FOCUS_COMPOSE_DRAFT_EVENT");
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
