// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_CHAT_COMPOSER_SUBMIT_EVENT,
  agentChatPreviousTurnText,
  reportAgentChatComposerSubmit,
  subscribeAgentChatComposerSubmit,
} from "./agent-chat.js";

const user = (text: string) => ({ role: "user", text });
const assistant = (text: string) => ({ role: "assistant", text });

describe("composer submit announcements", () => {
  it("delivers each send to subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentChatComposerSubmit(listener);

    reportAgentChatComposerSubmit({
      text: "show my planner",
      threadId: "thread-1",
      previousTurn: "User: hi",
    });
    unsubscribe();
    reportAgentChatComposerSubmit({ text: "after unsubscribe" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      text: "show my planner",
      threadId: "thread-1",
      previousTurn: "User: hi",
    });
  });

  it("announces nothing for a blank message", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentChatComposerSubmit(listener);
    reportAgentChatComposerSubmit({ text: "   " });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("reads the named window event and ignores malformed details", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentChatComposerSubmit(listener);
    for (const detail of [null, "text", { text: 3 }, { text: "from a host" }]) {
      window.dispatchEvent(
        new CustomEvent(AGENT_CHAT_COMPOSER_SUBMIT_EVENT, { detail }),
      );
    }
    unsubscribe();
    expect(AGENT_CHAT_COMPOSER_SUBMIT_EVENT).toBe(
      "agentNative.chatComposerSubmit",
    );
    expect(listener.mock.calls).toEqual([[{ text: "from a host" }]]);
  });
});

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

  it("clips each message, skips empty ones and leaves out other roles", () => {
    const text = agentChatPreviousTurnText([
      user("x".repeat(500)),
      { role: "system", text: "setup" },
      assistant("  "),
      assistant("y".repeat(500)),
    ]);
    expect(text).toBe(
      `User: ${"x".repeat(230)}\nAssistant: ${"y".repeat(230)}`,
    );
  });

  it("clips the whole context", () => {
    const long = "z".repeat(400);
    const text = agentChatPreviousTurnText([
      user(long),
      assistant(long),
      user(long),
      assistant(long),
      user(long),
      assistant(long),
    ]);
    expect(text).toHaveLength(1500);
    expect(text?.startsWith(`User: ${"z".repeat(230)}\nAssistant: `)).toBe(
      true,
    );
  });
});
