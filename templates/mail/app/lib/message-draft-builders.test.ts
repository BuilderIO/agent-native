import type { EmailMessage } from "@shared/types";
import { describe, expect, it } from "vitest";

import { buildForwardDraft, buildReplyDraft } from "./message-draft-builders";

const ownerEmails = new Set(["owner@acme.test", "alias@acme.test"]);

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: "message-42",
    threadId: "thread-17",
    from: { name: "Rae Sender", email: "rae@example.test" },
    to: [{ name: "Owner", email: "owner@acme.test" }],
    cc: [],
    subject: "Project update",
    snippet: "Synthetic preview",
    body: "First line\nSecond line",
    date: "2026-04-03T12:30:00.000Z",
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
    ...overrides,
  };
}

describe("EmailThread draft builders", () => {
  it("builds a reply to an external sender with quoted body and source account", () => {
    const source = message({
      to: [{ name: "Owner", email: "owner@acme.test" }],
      accountEmail: "owner@acme.test",
    });

    expect(buildReplyDraft(source, ownerEmails, { inline: true })).toEqual({
      to: "rae@example.test",
      subject: "Re: Project update",
      body: `\n\n\n\n— On ${new Date(source.date).toLocaleDateString()}, Rae Sender wrote:\n\n> First line\n> Second line`,
      mode: "reply",
      replyToId: "message-42",
      replyToThreadId: "thread-17",
      accountEmail: "owner@acme.test",
      inline: true,
    });
  });

  it("replies to the first external recipient when the selected message is from an owner account", () => {
    const source = message({
      from: { name: "Owner", email: "ALIAS@ACME.TEST" },
      to: [
        { name: "Rae", email: "rae@example.test" },
        { name: "Another owner", email: "owner@acme.test" },
      ],
      subject: "Re: Existing subject",
      accountEmail: undefined,
    });

    const draft = buildReplyDraft(source, ownerEmails, { inline: true });

    expect(draft.to).toBe("rae@example.test");
    expect(draft.subject).toBe("Re: Existing subject");
    expect(draft.replyToId).toBe("message-42");
    expect(draft.replyToThreadId).toBe("thread-17");
    expect(draft.accountEmail).toBe("owner@acme.test");
    expect(draft.inline).toBe(true);
  });

  it("deduplicates Reply All recipients in encounter order and excludes owner accounts", () => {
    const source = message({
      to: [
        { name: "Owner", email: "OWNER@ACME.TEST" },
        { name: "Lee", email: "lee@example.test" },
        { name: "Rae duplicate", email: "RAE@example.test" },
      ],
      cc: [
        { name: "Alias", email: "alias@acme.test" },
        { name: "Sam", email: "sam@example.test" },
        { name: "Lee duplicate", email: "LEE@example.test" },
      ],
    });

    const draft = buildReplyDraft(source, ownerEmails, {
      replyAll: true,
      inline: true,
    });

    expect(draft.to).toBe(
      "rae@example.test, lee@example.test, sam@example.test",
    );
    expect(draft.mode).toBe("reply");
    expect(draft.subject).toBe("Re: Project update");
    expect(draft.replyToId).toBe("message-42");
    expect(draft.replyToThreadId).toBe("thread-17");
    expect(draft.accountEmail).toBe("owner@acme.test");
    expect(draft.inline).toBe(true);
  });

  it("builds a forward draft with original body, source ids/account, and attachment metadata", () => {
    const source = message({
      subject: "Fwd: Existing subject",
      accountEmail: "owner@acme.test",
      attachments: [
        {
          id: "attachment-9",
          filename: "brief.pdf",
          mimeType: "application/pdf",
          size: 1234,
        },
      ],
    });

    expect(buildForwardDraft(source, ownerEmails, { inline: true })).toEqual({
      to: "",
      subject: "Fwd: Existing subject",
      body: "\n\n\n\n— Forwarded message —\nFrom: Rae Sender <rae@example.test>\n\nFirst line\nSecond line",
      mode: "forward",
      replyToId: "message-42",
      replyToThreadId: "thread-17",
      accountEmail: "owner@acme.test",
      attachments: [
        {
          id: "attachment-9",
          filename: "brief.pdf",
          originalName: "brief.pdf",
          mimeType: "application/pdf",
          size: 1234,
          url: "/api/attachments?messageId=message-42&id=attachment-9&mimeType=application%2Fpdf",
          source: "gmail",
          gmailMessageId: "message-42",
          gmailAttachmentId: "attachment-9",
          accountEmail: "owner@acme.test",
        },
      ],
      inline: true,
    });
  });

  it("adds the forward subject prefix when it is absent", () => {
    expect(
      buildForwardDraft(message(), ownerEmails, { inline: true }).subject,
    ).toBe("Fwd: Project update");
  });

  it("leaves list-composer drafts non-inline", () => {
    expect(buildReplyDraft(message(), ownerEmails).inline).toBeUndefined();
    expect(buildForwardDraft(message(), ownerEmails).inline).toBeUndefined();
  });
});
