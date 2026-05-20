// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { getFeedbackClientContext } from "./feedback-context.js";

describe("getFeedbackClientContext", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("returns explicit, active-run, and recently open chat session ids", () => {
    sessionStorage.setItem(
      "agent-chat-active-run",
      JSON.stringify({
        threadId: "running-thread",
        runId: "run-1",
        lastSeq: 3,
      }),
    );
    localStorage.setItem("agent-chat-active-thread", "general-thread");
    localStorage.setItem("agent-chat-active-thread:seen", "100");
    localStorage.setItem(
      "agent-chat-active-thread:app:scope:deck:deck-1",
      "scoped-thread",
    );
    localStorage.setItem(
      "agent-chat-active-thread:app:scope:deck:deck-1:seen",
      "200",
    );

    const context = getFeedbackClientContext("explicit-thread");

    expect(context.chatSessionIds).toEqual([
      "explicit-thread",
      "running-thread",
      "scoped-thread",
      "general-thread",
    ]);
    expect(context.activeRunId).toBe("run-1");
    expect(context.pageUrl).toBe(window.location.href);
  });

  it("dedupes chat session ids", () => {
    sessionStorage.setItem(
      "agent-chat-active-run",
      JSON.stringify({
        threadId: "same-thread",
        runId: "run-1",
        lastSeq: 3,
      }),
    );
    localStorage.setItem("agent-chat-active-thread", "same-thread");

    const context = getFeedbackClientContext("same-thread");

    expect(context.chatSessionIds).toEqual(["same-thread"]);
  });
});
