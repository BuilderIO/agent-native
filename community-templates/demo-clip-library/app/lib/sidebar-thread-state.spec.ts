import type { ChatThreadSummary } from "@agent-native/core/client/agent-chat";
import { ownDraftRows } from "@agent-native/toolkit/app/chat/ownership-history";
import { describe, expect, it } from "vitest";

describe("Chat sidebar ownership drafts", () => {
  it("keeps known owned empty starts and excludes shared or untouched empty rows", () => {
    const threads = [
      {
        id: "owned-in-flight",
        title: "",
        preview: "",
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
        scope: null,
        ownerEmail: "me@example.test",
        accessBasis: "owner",
        visibility: "private",
      },
      {
        id: "shared",
        title: "",
        preview: "",
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
        scope: null,
        ownerEmail: "other@example.test",
        accessBasis: "direct",
        visibility: "private",
      },
      {
        id: "untouched",
        title: "",
        preview: "",
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
        scope: null,
      },
    ] satisfies ChatThreadSummary[];

    const rows = ownDraftRows({
      threads,
      isNewThread: (id) => id === "synthesized",
      observedThreadStarts: new Map([
        ["owned-in-flight", 2],
        ["shared", 3],
        ["synthesized", 4],
      ]),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "owned-in-flight",
      "synthesized",
    ]);
  });
});
