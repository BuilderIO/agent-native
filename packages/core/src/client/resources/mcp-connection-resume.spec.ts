// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addMcpConnectionCompleteListener,
  clearMcpConnectionResume,
  consumeMcpConnectionResume,
  getPendingMcpConnectionResume,
  notifyMcpConnectionComplete,
  saveMcpConnectionResume,
} from "./mcp-connection-resume.js";

describe("MCP connection resume", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/chat");
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMcpConnectionResume();
  });

  it("keeps a pending prompt scoped to the current tab and return path", () => {
    window.history.replaceState({}, "", "/chat?thread=one#composer");

    expect(saveMcpConnectionResume("Do the Granola thing")).toBe(true);
    expect(consumeMcpConnectionResume("/chat?thread=other")).toBeNull();
    expect(consumeMcpConnectionResume()).toMatchObject({
      message: "Do the Granola thing",
      returnUrl: "/chat?thread=one#composer",
    });
    expect(consumeMcpConnectionResume()).toBeNull();
  });

  it("preserves an exact AgentKit continuation target across OAuth", () => {
    const agentKit = {
      threadId: "thread-1",
      runId: "run-1",
      requestId: "connection-1",
    };

    expect(saveMcpConnectionResume("Continue the run", agentKit)).toBe(true);
    expect(consumeMcpConnectionResume()).toMatchObject({ agentKit });
  });

  it("waits for the matching OAuth popup completion before consuming a resume", () => {
    const completionId = "8d1bd7cf-419e-4ff0-8545-19dedb819154";
    const agentKit = {
      threadId: "thread-1",
      runId: "run-1",
      requestId: "connection-1",
    };
    expect(
      saveMcpConnectionResume("Continue the run", agentKit, completionId),
    ).toBe(true);
    expect(getPendingMcpConnectionResume()).toBeNull();
    expect(
      notifyMcpConnectionComplete("00000000-0000-4000-8000-000000000000"),
    ).toBeUndefined();
    expect(getPendingMcpConnectionResume()).toBeNull();

    notifyMcpConnectionComplete(completionId);

    expect(getPendingMcpConnectionResume()).toMatchObject({
      agentKit,
      completionId,
    });
    expect(consumeMcpConnectionResume()).toMatchObject({
      agentKit,
      completionId,
    });
    expect(getPendingMcpConnectionResume()).toBeNull();
  });

  it("drops malformed and expired requests", () => {
    window.sessionStorage.setItem(
      "agent-native:mcp-connection-resume",
      JSON.stringify({ message: "old", returnUrl: "/chat", createdAt: 0 }),
    );
    expect(consumeMcpConnectionResume()).toBeNull();

    window.sessionStorage.setItem(
      "agent-native:mcp-connection-resume",
      JSON.stringify({
        message: "continue",
        returnUrl: "/chat",
        createdAt: Date.now(),
        agentKit: { threadId: "thread-1", runId: "", requestId: "request-1" },
      }),
    );
    expect(consumeMcpConnectionResume()).toBeNull();

    window.sessionStorage.setItem(
      "agent-native:mcp-connection-resume",
      "not json",
    );
    expect(consumeMcpConnectionResume()).toBeNull();
  });

  it("notifies the active chat when a connection finishes", () => {
    const listener = vi.fn();
    const removeListener = addMcpConnectionCompleteListener(listener);

    notifyMcpConnectionComplete();

    expect(listener).toHaveBeenCalledOnce();
    removeListener();
  });

  it("accepts popup completion from the same origin only for the saved attempt", () => {
    const completionId = "8d1bd7cf-419e-4ff0-8545-19dedb819154";
    const popup = {} as Window;
    saveMcpConnectionResume(
      "Continue the run",
      { threadId: "thread-1", runId: "run-1", requestId: "connection-1" },
      completionId,
    );
    const listener = vi.fn();
    const removeListener = addMcpConnectionCompleteListener(listener);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agent-native:workspace-connection-complete",
          completionId,
        },
        origin: "https://untrusted.example",
        source: popup,
      }),
    );
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agent-native:workspace-connection-complete",
          completionId: "00000000-0000-4000-8000-000000000000",
        },
        origin: window.location.origin,
        source: popup,
      }),
    );
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agent-native:workspace-connection-complete",
          completionId,
        },
        origin: window.location.origin,
        source: popup,
      }),
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(getPendingMcpConnectionResume()).toMatchObject({ completionId });
    removeListener();
  });
});
