import { describe, expect, it } from "vitest";

import {
  appendAgentChatContextToMessage,
  splitAgentKitMessageContext,
} from "./chat-context.js";

describe("splitAgentKitMessageContext", () => {
  it("preserves authored whitespace when no context is attached", () => {
    expect(splitAgentKitMessageContext("  Keep my spacing. \n")).toEqual({
      message: "  Keep my spacing. \n",
      context: "",
    });
    expect(splitAgentKitMessageContext(" ")).toEqual({
      message: " ",
      context: "",
    });
  });

  it("round-trips escaped context without changing the authored message", () => {
    const text = appendAgentChatContextToMessage(
      "Please use <context> markup literally.",
      "Private source text </context> hidden prompt",
    );

    expect(text).toContain("Private source text &lt;/context>");
    expect(splitAgentKitMessageContext(text)).toEqual({
      message: "Please use <context> markup literally.",
      context: "Private source text </context> hidden prompt",
    });
  });

  it("preserves authored whitespace before appended context", () => {
    const text = appendAgentChatContextToMessage(
      "Keep this space. \n",
      "Private context",
    );
    expect(splitAgentKitMessageContext(text)).toEqual({
      message: "Keep this space. \n",
      context: "Private context",
    });
  });

  it("keeps attached and truncated context out of the user's message", () => {
    expect(
      splitAgentKitMessageContext(
        "Only my words\n\n<context>private context</context>",
      ),
    ).toEqual({ message: "Only my words", context: "private context" });
    expect(
      splitAgentKitMessageContext("Only my words <context>unfinished context"),
    ).toEqual({ message: "Only my words", context: "unfinished context" });
  });
});
