import { describe, expect, it } from "vitest";

import { isAssistantChatHistoryVersion } from "./assistant-chat-history-version.js";

describe("isAssistantChatHistoryVersion", () => {
  it("accepts non-empty ids with valid dates", () => {
    expect(
      isAssistantChatHistoryVersion({ id: "v1", createdAt: "2026-01-01" }),
    ).toBe(true);
    expect(
      isAssistantChatHistoryVersion({ id: "v2", createdAt: new Date() }),
    ).toBe(true);
    expect(isAssistantChatHistoryVersion({ id: "v3", createdAt: 0 })).toBe(
      true,
    );
  });

  it("rejects malformed versions", () => {
    expect(isAssistantChatHistoryVersion(null)).toBe(false);
    expect(isAssistantChatHistoryVersion({ id: " ", createdAt: 0 })).toBe(
      false,
    );
    expect(
      isAssistantChatHistoryVersion({ id: "v1", createdAt: "not-a-date" }),
    ).toBe(false);
  });
});
