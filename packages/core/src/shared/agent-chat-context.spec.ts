import { describe, expect, it } from "vitest";

import {
  appendAgentChatContextToMessage,
  splitAgentChatContextFromMessage,
} from "./agent-chat-context.js";

describe("splitAgentChatContextFromMessage", () => {
  it("round-trips what appendAgentChatContextToMessage joined", () => {
    const composed = appendAgentChatContextToMessage(
      "make it darker",
      "Design id: design-1",
    );

    expect(splitAgentChatContextFromMessage(composed)).toEqual({
      message: "make it darker",
      context: "Design id: design-1",
    });
  });

  it("keeps context and user markup intact when the context contains its closing tag", () => {
    const composed = appendAgentChatContextToMessage(
      "Keep <context> markup in my request</context>",
      "before </context> after &lt;/context&gt;",
    );

    expect(composed).not.toContain("before </context> after");
    expect(splitAgentChatContextFromMessage(composed)).toEqual({
      message: "Keep <context> markup in my request</context>",
      context: "before </context> after &lt;/context&gt;",
    });
  });

  it("keeps every attached block out of the user's own words", () => {
    const { message, context } = splitAgentChatContextFromMessage(
      "hi\n\n<context>\nfirst\n</context>\n\n<context>\nsecond\n</context>",
    );

    expect(message).toBe("hi");
    expect(context).toBe("first\nsecond");
  });

  it("reports a truncated payload as context rather than as the message", () => {
    expect(
      splitAgentChatContextFromMessage("hi <context> ## Fusion recap payload"),
    ).toEqual({ message: "hi", context: "## Fusion recap payload" });
  });

  it("returns an empty message for a context-only send", () => {
    expect(
      splitAgentChatContextFromMessage(
        "\n\n<context>\ninstructions\n</context>",
      ),
    ).toEqual({ message: "", context: "instructions" });
  });

  it("leaves a message with no attached context untouched", () => {
    expect(splitAgentChatContextFromMessage("hi")).toEqual({
      message: "hi",
      context: "",
    });
  });
});
