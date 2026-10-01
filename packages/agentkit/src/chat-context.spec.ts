import { describe, expect, it } from "vitest";

import { splitAgentKitMessageContext } from "./chat-context.js";

describe("splitAgentKitMessageContext", () => {
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
