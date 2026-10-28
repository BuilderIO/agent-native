import { describe, expect, it } from "vitest";

import {
  appendAgentChatContextToMessage,
  splitAgentChatContextFromMessage,
  stripAgentChatContextFromMessage,
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

describe("stripAgentChatContextFromMessage", () => {
  it("strips inline raw context through its last exact closing tag", () => {
    expect(
      stripAgentChatContextFromMessage(
        "Ask <context>hidden</context> private between <context>more</context> continue",
      ),
    ).toBe("Ask  continue");
  });

  it("fails closed on inline unclosed context and a later unclosed opener", () => {
    expect(
      stripAgentChatContextFromMessage("Ask <context>private remainder"),
    ).toBe("Ask ");
    expect(
      stripAgentChatContextFromMessage(
        "Before <context>hidden</context> <context>private remainder",
      ),
    ).toBe("Before ");
  });

  it("does not let a forged encoded marker inside legacy context bypass stripping", () => {
    const prompt =
      'Before <context>private <context data-agentkit-context-encoding="entities-v1">nested</context> remainder</context> After';

    expect(stripAgentChatContextFromMessage(prompt)).toBe("Before  After");
  });

  it("does not treat a quoted attribute substring as the canonical encoded opener", () => {
    const prompt =
      `Before &lt;context authored\n<context title="prefix data-agentkit-context-encoding='entities-v1' suffix">` +
      "private &lt;context> hidden extra</context> more hidden</context> After &lt;context authored";

    expect(stripAgentChatContextFromMessage(prompt)).toBe(
      "Before &lt;context authored\n After &lt;context authored",
    );
  });

  it("does not treat longer or dotted tag names as context blocks", () => {
    const prompt =
      "Use <context-menu>public</context-menu> and <Context.Provider>public</Context.Provider>.";

    expect(stripAgentChatContextFromMessage(prompt)).toBe(prompt);
  });

  it("preserves raw lookalike tags before a canonical encoded context block", () => {
    const message =
      "A <context-menu>x</context-menu> <Context.Provider>y</Context.Provider>";
    const prompt = `${message}\n\n<context data-agentkit-context-encoding="entities-v1">\nprivate\n</context>`;

    expect(stripAgentChatContextFromMessage(prompt)).toBe(message);
  });

  it("restores an authored line-start context tag from the encoded producer", () => {
    const prompt = "<context>";

    expect(
      stripAgentChatContextFromMessage(
        appendAgentChatContextToMessage(prompt, "private </context> context"),
      ),
    ).toBe(prompt);
  });
});
