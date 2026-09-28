import { describe, expect, it } from "vitest";

import { visibleChatThreads } from "./sidebar-thread-state";

describe("visibleChatThreads", () => {
  it("shows an accepted new conversation before durable history catches up", () => {
    const result = visibleChatThreads([], new Map([["thread-new", 42]]));

    expect(result).toEqual([
      expect.objectContaining({
        id: "thread-new",
        messageCount: 0,
        createdAt: 42,
        updatedAt: 42,
      }),
    ]);
  });

  it("does not expose untouched empty tabs and does not duplicate persisted threads", () => {
    const threads = [
      {
        id: "thread-empty",
        title: "",
        preview: "",
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
        scope: null,
      },
      {
        id: "thread-live",
        title: "Live",
        preview: "Prompt",
        messageCount: 1,
        createdAt: 2,
        updatedAt: 2,
        scope: null,
      },
    ];

    const result = visibleChatThreads(threads, new Map([["thread-live", 2]]));

    expect(result.map((thread) => thread.id)).toEqual(["thread-live"]);
  });
});
