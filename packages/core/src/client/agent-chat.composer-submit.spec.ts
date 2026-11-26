// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_CHAT_COMPOSER_SUBMIT_EVENT,
  agentChatPreviousTurnText,
  reportAgentChatComposerSubmit,
  subscribeAgentChatComposerSubmit,
  withdrawAgentChatComposerSubmit,
} from "./agent-chat.js";

const user = (text: string) => ({ role: "user", text });
const assistant = (text: string) => ({ role: "assistant", text });

describe("composer submit announcements", () => {
  it("delivers each send to subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentChatComposerSubmit(listener);

    const id = reportAgentChatComposerSubmit({
      text: "show my planner",
      threadId: "thread-1",
      previousTurn: "User: hi",
    });
    withdrawAgentChatComposerSubmit(id);
    withdrawAgentChatComposerSubmit(null);
    unsubscribe();
    const later = reportAgentChatComposerSubmit({ text: "after unsubscribe" });

    expect(id).toEqual(expect.any(String));
    expect(later).not.toBe(id);
    expect(listener.mock.calls).toEqual([
      [
        {
          id,
          text: "show my planner",
          threadId: "thread-1",
          previousTurn: "User: hi",
        },
      ],
      [{ id, text: "", withdrawn: true }],
    ]);
  });

  it("announces nothing for a blank message", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentChatComposerSubmit(listener);
    expect(reportAgentChatComposerSubmit({ text: "   " })).toBeNull();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("reads the named window event and ignores malformed details", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentChatComposerSubmit(listener);
    for (const detail of [
      null,
      "text",
      { id: "a", text: 3 },
      { text: "no id" },
      { id: "b", text: "from a host" },
    ]) {
      window.dispatchEvent(
        new CustomEvent(AGENT_CHAT_COMPOSER_SUBMIT_EVENT, { detail }),
      );
    }
    unsubscribe();
    expect(AGENT_CHAT_COMPOSER_SUBMIT_EVENT).toBe(
      "agentNative.chatComposerSubmit",
    );
    expect(listener.mock.calls).toEqual([[{ id: "b", text: "from a host" }]]);
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

  it("keeps only the ask each reply answered, so a burst stays short", () => {
    const burst = Array.from({ length: 40 }, (_, index) =>
      user(`${index} ${"q".repeat(300)}`),
    );
    const text = agentChatPreviousTurnText([
      user("first ask"),
      assistant("first reply"),
      ...burst,
      assistant("second reply"),
      ...burst,
    ]);
    expect(text).toBe(
      [
        "User: first ask",
        "Assistant: first reply",
        `User: ${`39 ${"q".repeat(300)}`.slice(0, 230)}`,
        "Assistant: second reply",
      ].join("\n"),
    );
  });

  it("keeps the ask a reply without text answered", () => {
    expect(
      agentChatPreviousTurnText([user("show my planner"), assistant("")]),
    ).toBe("User: show my planner");
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
});
