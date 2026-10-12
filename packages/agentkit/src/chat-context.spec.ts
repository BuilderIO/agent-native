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

  it("preserves context-like tag names before a canonical encoded block", () => {
    const message =
      "A <context-menu>x</context-menu> <Context.Provider>y</Context.Provider>";
    const text = `${message}\n\n<context data-agentkit-context-encoding="entities-v1">\nprivate &lt;context>\n</context>`;

    expect(splitAgentKitMessageContext(text)).toEqual({
      message,
      context: "private <context>",
    });
  });

  it("ignores closed and unclosed lookalike tag names", () => {
    const closed =
      "Keep <context-menu>visible</context-menu> and <Context.Provider>visible</Context.Provider>.";
    const unclosed = "Keep <context-menu>visible and <Context.Provider>visible";

    expect(splitAgentKitMessageContext(closed)).toEqual({
      message: closed,
      context: "",
    });
    expect(splitAgentKitMessageContext(unclosed)).toEqual({
      message: unclosed,
      context: "",
    });
  });
});
