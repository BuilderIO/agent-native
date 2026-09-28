import { describe, expect, it } from "vitest";

import {
  aiFilterBackfillRetryDelay,
  backfillActionEffects,
  canonicalAiFilterBackfillRuleSetKey,
  hasLocalInboxMessage,
  isCurrentAiFilterBackfillRule,
  latestGmailInboxMessage,
  latestLocalInboxMessage,
  missingSnapshotMessageIds,
  originalSnapshotValue,
  planConditionalUndo,
  pendingUndoSnapshots,
  sanitizeBackfillError,
} from "./ai-filter-backfill.js";
import { GmailQuotaCooldownError } from "./google-api.js";

describe("backfill retry handling", () => {
  it("backs off for Gmail cooldowns and transient network failures", () => {
    expect(
      aiFilterBackfillRetryDelay(
        new GmailQuotaCooldownError("try again later", 90_000),
      ),
    ).toBe(90_000);
    expect(
      aiFilterBackfillRetryDelay(
        new GmailQuotaCooldownError("try again later", 60 * 60_000),
      ),
    ).toBe(5 * 60_000);
    const aborted = new Error("request was aborted");
    aborted.name = "AbortError";
    expect(aiFilterBackfillRetryDelay(aborted)).toBe(30_000);
    expect(aiFilterBackfillRetryDelay(new TypeError("fetch failed"))).toBe(
      30_000,
    );
    expect(aiFilterBackfillRetryDelay(new Error("invalid rule"))).toBeNull();
    expect(
      aiFilterBackfillRetryDelay(
        Object.assign(new Error("temporary credential refresh failure"), {
          retryable: true,
        }),
      ),
    ).toBe(30_000);
  });

  it("removes database parameter dumps from stored errors", () => {
    expect(
      sanitizeBackfillError(
        new Error(
          'database update failed\nparams: {"state_json":"private mail"}',
        ),
      ),
    ).toBe("database update failed");
  });
});

describe("backfill undo state", () => {
  it("applies notify-rule highlighting without historical notifications", () => {
    expect(
      backfillActionEffects([
        { type: "label", labelName: "agent-native-important" },
        { type: "notify" },
      ]),
    ).toEqual({ labels: ["agent-native-important"], archive: false });
  });

  it("only restores fields that still equal the post-apply value", () => {
    expect(
      planConditionalUndo(
        { important: false, inbox: true },
        { important: true, inbox: false },
        { important: true, inbox: true },
      ),
    ).toEqual({
      changes: { important: false },
      conflicts: ["inbox"],
    });
  });

  it("treats legacy snapshots without post-apply values as conflicts", () => {
    expect(
      planConditionalUndo({ label: false }, undefined, { label: true }),
    ).toEqual({ changes: {}, conflicts: ["label"] });
  });

  it("canonicalizes a rule set independent of request order", () => {
    expect(canonicalAiFilterBackfillRuleSetKey(["rule-b", "rule-a"])).toBe(
      '["rule-a","rule-b"]',
    );
  });

  it("keeps the first archive state when later rules also archive", () => {
    expect(originalSnapshotValue(false, true)).toBe(false);
  });

  it("allows newer local replies while requiring every saved message", () => {
    expect(
      missingSnapshotMessageIds(
        ["saved-incoming"],
        new Set(["saved-incoming", "new-reply"]),
      ),
    ).toEqual([]);
    expect(
      missingSnapshotMessageIds(["saved-incoming"], new Set(["new-reply"])),
    ).toEqual(["saved-incoming"]);
  });

  it("requires each matched rule to remain enabled at its captured version", () => {
    const currentRules = [
      {
        id: "rule-a",
        enabled: true,
        domain: "mail",
        kind: "ai-filter",
        updatedAt: "v1",
      },
    ];

    expect(isCurrentAiFilterBackfillRule("rule-a", "v1", currentRules)).toBe(
      true,
    );
    expect(isCurrentAiFilterBackfillRule("rule-a", "v2", currentRules)).toBe(
      false,
    );
    expect(isCurrentAiFilterBackfillRule("missing", "v1", currentRules)).toBe(
      false,
    );
    expect(
      isCurrentAiFilterBackfillRule("rule-a", "v1", [
        { ...currentRules[0], enabled: false },
      ]),
    ).toBe(false);
  });
});

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
