import { describe, expect, it } from "vitest";

import { fallbackChatTitle } from "./fallback-chat-title.js";

// oracle-change: removed replays of core context-stripping edge cases (nested marker, lookalike tags, encoded producer); packages/core/src/shared/agent-chat-context.spec.ts owns stripAgentChatContextFromMessage

describe("fallbackChatTitle", () => {
  it("strips inline legacy context whether it is closed or unclosed", () => {
    expect(fallbackChatTitle("Plan <context>private</context> next")).toBe(
      "Plan next",
    );
    expect(fallbackChatTitle("Plan <context>private remainder")).toBe("Plan");
  });
});
