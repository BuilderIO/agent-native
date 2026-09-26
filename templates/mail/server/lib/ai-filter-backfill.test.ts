import { describe, expect, it } from "vitest";

import {
  hasLocalInboxMessage,
  latestGmailInboxMessage,
  latestLocalInboxMessage,
  pendingUndoSnapshots,
} from "./ai-filter-backfill.js";

describe("pendingUndoSnapshots", () => {
  it("does not mistake matched inbox threads for restored snapshots", () => {
    const snapshots = [{ key: "matched-and-applied" }, { key: "applied" }];

    expect(pendingUndoSnapshots(snapshots, [], [])).toEqual(snapshots);
    expect(
      pendingUndoSnapshots(snapshots, ["matched-and-applied"], []),
    ).toEqual([{ key: "applied" }]);
    expect(
      pendingUndoSnapshots(snapshots, ["matched-and-applied"], ["applied"]),
    ).toEqual([]);
  });
});

describe("hasLocalInboxMessage", () => {
  it("skips sent-only, draft, archived, and trashed mail", () => {
    expect(
      hasLocalInboxMessage([
        {
          isArchived: false,
          isTrashed: false,
          isDraft: false,
          isSent: true,
        },
      ]),
    ).toBe(false);
    expect(
      hasLocalInboxMessage([
        {
          isArchived: true,
          isTrashed: false,
          isDraft: false,
          isSent: false,
        },
      ]),
    ).toBe(false);
    expect(
      hasLocalInboxMessage([
        {
          isArchived: false,
          isTrashed: false,
          isDraft: false,
          isSent: false,
        },
      ]),
    ).toBe(true);
  });
});

describe("latestInboxMessage", () => {
  it("uses the latest received Inbox message instead of a later sent reply", () => {
    const inboxMessage = {
      id: "incoming",
      threadId: "thread",
      from: { name: "Manager", email: "manager@example.test" },
      to: [],
      subject: "Review needed",
      snippet: "Can you review this?",
      body: "",
      date: "2026-09-25T10:00:00.000Z",
      isRead: true,
      isStarred: false,
      isArchived: false,
      isTrashed: false,
      isSent: false,
      labelIds: ["inbox"],
    };
    const sentReply = {
      ...inboxMessage,
      id: "outgoing",
      from: { name: "Me", email: "me@example.test" },
      subject: "Thanks, done",
      date: "2026-09-25T11:00:00.000Z",
      isSent: true,
      labelIds: ["sent"],
    };

    expect(latestLocalInboxMessage([inboxMessage, sentReply] as any)?.id).toBe(
      "incoming",
    );
    expect(
      latestGmailInboxMessage([
        { id: "incoming", internalDate: "1000", labelIds: ["INBOX"] },
        { id: "outgoing", internalDate: "2000", labelIds: ["SENT"] },
      ])?.id,
    ).toBe("incoming");
  });
});
