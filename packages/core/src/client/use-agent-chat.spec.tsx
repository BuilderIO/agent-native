// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentChatGenerating } from "./use-agent-chat.js";

const agentChatMocks = vi.hoisted(() => ({
  sendToAgentChat: vi.fn(() => "requested-new-tab"),
}));

vi.mock("./agent-chat.js", () => ({
  AGENT_CHAT_SUBMIT_TARGET_EVENT: "agentNative.chatSubmitTarget",
  generateAgentChatSubmitMessageId: () => "submit-1",
  sendToAgentChat: agentChatMocks.sendToAgentChat,
}));

describe("useAgentChatGenerating", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: ReturnType<typeof useAgentChatGenerating> | null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    hook = null;

    function Harness() {
      hook = useAgentChatGenerating();
      return null;
    }

    act(() => {
      root.render(<Harness />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("tracks completion on an empty tab reused by the receiver", () => {
    act(() => {
      hook![1]({
        message: "Create a presentation",
        newTab: true,
        reuseEmptyTab: true,
      });
    });

    expect(hook![0]).toBe(true);
    expect(agentChatMocks.sendToAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({ submitMessageId: "submit-1" }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId: "submit-1", tabId: "existing-empty-tab" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "existing-empty-tab" },
        }),
      );
    });

    expect(hook![0]).toBe(false);
  });

  it("reports an explicit stop separately from a continuation gap", () => {
    act(() => {
      hook![1]({
        message: "Create a presentation",
        newTab: true,
      });
    });

    expect(hook![2]).toBe(null);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "requested-new-tab",
            reason: "stopped",
          },
        }),
      );
    });

    expect(hook![0]).toBe(false);
    expect(hook![2]).toBe("stopped");
  });
  it("ignores unscoped completion events for an active scoped run", () => {
    act(() => {
      hook![1]({ message: "Create a presentation", newTab: true });
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, reason: "stopped" },
        }),
      );
    });

    expect(hook![0]).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "requested-new-tab",
            reason: "stopped",
          },
        }),
      );
    });

    expect(hook![0]).toBe(false);
  });
});
