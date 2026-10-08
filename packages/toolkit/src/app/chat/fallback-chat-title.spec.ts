import { appendAgentChatContextToMessage } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import { fallbackChatTitle } from "./fallback-chat-title.js";

describe("fallbackChatTitle", () => {
  it("strips inline legacy context whether it is closed or unclosed", () => {
    expect(fallbackChatTitle("Plan <context>private</context> next")).toBe(
      "Plan next",
    );
    expect(fallbackChatTitle("Plan <context>private remainder")).toBe("Plan");
  });

  it("does not let a nested encoded-looking marker escape legacy context", () => {
    expect(
      fallbackChatTitle(
        'Plan <context>private <context data-agentkit-context-encoding="entities-v1">nested</context> private</context> next',
      ),
    ).toBe("Plan next");
  });

  it("does not strip longer or dotted tag names", () => {
    const prompt =
      "<context-menu>ok</context-menu> <Context.Provider>ok</Context.Provider>";

    expect(fallbackChatTitle(prompt)).toBe(prompt);
  });

  it("preserves an authored exact marker through the encoded producer", () => {
    expect(
      fallbackChatTitle(
        appendAgentChatContextToMessage("<context>", "private </context>"),
      ),
    ).toBe("<context>");
  });
});
