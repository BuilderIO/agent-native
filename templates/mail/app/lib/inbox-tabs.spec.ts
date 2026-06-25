import type { EmailMessage } from "@shared/types";
import { describe, expect, it } from "vitest";

import { augmentSelfSentLabels, filterInboxTabEmails } from "./inbox-tabs";

const self = { name: "Steve", email: "steve@builder.io" };
const other = { name: "Mike", email: "mike@example.com" };

function message(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: "message",
    threadId: "thread",
    from: other,
    to: [self],
    subject: "Subject",
    snippet: "",
    body: "",
    date: "2026-05-20T00:00:00.000Z",
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
    ...overrides,
  };
}

function augment(emails: EmailMessage[], hasNoteToSelf = true) {
  return augmentSelfSentLabels(emails, {
    isGoogleConnected: true,
    connectedEmails: new Set([self.email]),
    hasNoteToSelf,
  });
}

describe("augmentSelfSentLabels", () => {
  it("does not classify ordinary threads as note-to-self just because the latest message is from me", () => {
    const received = message({
      id: "received",
      date: "2026-05-20T00:00:00.000Z",
      labelIds: ["inbox"],
    });
    const sentReply = message({
      id: "sent-reply",
      date: "2026-05-21T00:00:00.000Z",
      from: self,
      to: [other, self],
      isSent: true,
      labelIds: ["sent"],
    });

    const augmented = augment([received, sentReply]);

    expect(
      augmented.find((e) => e.id === "sent-reply")?.labelIds,
    ).not.toContain("note-to-self");
    expect(augmented.find((e) => e.id === "sent-reply")?.labelIds).toContain(
      "important",
    );
    expect(
      filterInboxTabEmails(augmented, "note-to-self", [
        "important",
        "note-to-self",
      ]).map((e) => e.id),
    ).toEqual([]);
  });

  it("classifies all-self threads as note-to-self when the tab is pinned", () => {
    const first = message({
      id: "self-note",
      date: "2026-05-20T00:00:00.000Z",
      from: self,
      to: [self],
      isSent: true,
      labelIds: ["inbox", "sent"],
    });
    const latest = message({
      id: "self-note-follow-up",
      date: "2026-05-21T00:00:00.000Z",
      from: self,
      to: [self],
      isSent: true,
      labelIds: ["sent"],
    });

    const augmented = augment([first, latest]);

    expect(
      augmented.find((e) => e.id === "self-note-follow-up")?.labelIds,
    ).toContain("note-to-self");
    expect(
      filterInboxTabEmails(augmented, "note-to-self", [
        "important",
        "note-to-self",
      ]).map((e) => e.id),
    ).toEqual(["self-note", "self-note-follow-up"]);
  });

  it("excludes a self-started thread once another participant appears", () => {
    const first = message({
      id: "self-note",
      date: "2026-05-20T00:00:00.000Z",
      from: self,
      to: [self],
      isSent: true,
      labelIds: ["inbox", "sent"],
    });
    const later = message({
      id: "forwarded",
      date: "2026-05-21T00:00:00.000Z",
      from: self,
      to: [self, other],
      isSent: true,
      labelIds: ["sent"],
    });

    const augmented = augment([first, later]);

    expect(augmented.flatMap((e) => e.labelIds)).not.toContain("note-to-self");
  });

  it("keeps the existing important fallback when note-to-self is not pinned", () => {
    const sentReply = message({
      id: "sent-reply",
      from: self,
      to: [other],
      isSent: true,
      labelIds: ["sent"],
    });

    expect(augment([sentReply], false)[0].labelIds).toContain("important");
  });
});
