// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { getFeedbackClientContext } from "./feedback-context.js";

describe("getFeedbackClientContext", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("returns explicit, active-run, and recently open namespaced chat session ids", () => {
    window.history.replaceState(null, "", "/inbox?token=secret&utm=ok#section");
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
    localStorage.setItem(
      "agent-chat-active-thread:other:scope:deck:deck-2",
      "other-app-thread",
    );
    localStorage.setItem(
      "agent-chat-active-thread:other:scope:deck:deck-2:seen",
      "300",
    );

    const context = getFeedbackClientContext({
      chatSessionId: "explicit-thread",
      storageKey: "app",
    });

    expect(context.chatSessionIds).toEqual([
      "explicit-thread",
      "running-thread",
      "scoped-thread",
    ]);
    expect(context.activeRunId).toBe("run-1");
    expect(context.pageUrl).toBe(
      "http://localhost:3000/inbox?token=%3Credacted%3E&utm=ok#section",
    );
    // happy-dom has no desktop/Tauri markers, so the surface resolves to web.
    expect(context.clientSurface).toBe("web");
  });

  it("detects the Tauri desktop surface from the injected global", () => {
    (
      window as unknown as { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    try {
      const context = getFeedbackClientContext();
      expect(context.clientSurface).toBe("tauri");
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__;
    }
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

    const context = getFeedbackClientContext({ chatSessionId: "same-thread" });

    expect(context.chatSessionIds).toEqual(["same-thread"]);
  });
});
