// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addMcpConnectionCompleteListener,
  clearMcpConnectionResume,
  consumeMcpConnectionResume,
  notifyMcpConnectionComplete,
  saveMcpConnectionResume,
} from "./mcp-connection-resume.js";

describe("MCP connection resume", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
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

  it("drops malformed and expired requests", () => {
    window.sessionStorage.setItem(
      "agent-native:mcp-connection-resume",
      JSON.stringify({ message: "old", returnUrl: "/chat", createdAt: 0 }),
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
});
