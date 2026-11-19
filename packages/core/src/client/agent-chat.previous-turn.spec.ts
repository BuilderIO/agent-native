import { describe, expect, it } from "vitest";

import { agentChatPreviousTurnText } from "./agent-chat.js";

const user = (text: string) => ({ role: "user", text });
const assistant = (text: string) => ({ role: "assistant", text });

describe("agentChatPreviousTurnText", () => {
  it("is undefined before the first reply", () => {
    expect(agentChatPreviousTurnText([])).toBeUndefined();
    expect(agentChatPreviousTurnText([user("hello")])).toBeUndefined();
  });

  it("keeps the last three exchanges in order", () => {
    expect(
      agentChatPreviousTurnText([
        user("one"),
        assistant("first"),
        user("two"),
        assistant("second"),
        user("three"),
        assistant("third"),
        user("four"),
        assistant("fourth"),
        user("unanswered"),
      ]),
    ).toBe(
      [
        "User: two",
        "Assistant: second",
        "User: three",
        "Assistant: third",
        "User: four",
        "Assistant: fourth",
      ].join("\n"),
    );
  });

  it("clips each message and skips empty ones", () => {
    const text = agentChatPreviousTurnText([
      user("x".repeat(500)),
      assistant("  "),
      assistant("ok"),
    ]);
    expect(text).toBe(`User: ${"x".repeat(230)}\nAssistant: ok`);
  });
});
