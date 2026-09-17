// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentChatState = vi.hoisted(() => ({
  generating: false,
  stopReason: null as "stopped" | null,
  send: vi.fn(),
}));
const agentEngineState = vi.hoisted(() => ({
  state: "configured" as "configured" | "missing",
}));
const toastState = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentChatGenerating: () =>
    [
      agentChatState.generating,
      agentChatState.send,
      agentChatState.stopReason,
    ] as const,
  useAgentEngineConfigured: () => ({
    state: agentEngineState.state,
    missing: agentEngineState.state === "missing",
  }),
}));
vi.mock("sonner", () => ({ toast: toastState }));

import {
  CHAT_STOP_DEBOUNCE_MS,
  useAgentGenerating,
} from "./use-agent-generating";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  agentChatState.generating = false;
  agentChatState.stopReason = null;
  agentChatState.send.mockReset();
  agentEngineState.state = "configured";
  toastState.error.mockReset();
});

describe("useAgentGenerating", () => {
  it("keeps generation active across brief continuation gaps", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() => useAgentGenerating());

    agentChatState.generating = true;
    rerender();
    expect(result.current.generating).toBe(true);

    agentChatState.generating = false;
    rerender();
    expect(result.current.generating).toBe(true);

    act(() => {
      vi.advanceTimersByTime(CHAT_STOP_DEBOUNCE_MS - 1);
    });
    expect(result.current.generating).toBe(true);

    agentChatState.generating = true;
    rerender();
    act(() => {
      vi.advanceTimersByTime(CHAT_STOP_DEBOUNCE_MS);
    });
    expect(result.current.generating).toBe(true);

    agentChatState.generating = false;
    rerender();
    act(() => {
      vi.advanceTimersByTime(CHAT_STOP_DEBOUNCE_MS);
    });
    expect(result.current.generating).toBe(false);
  });

  it("clears generation immediately for an explicit stop", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() => useAgentGenerating());

    agentChatState.generating = true;
    rerender();
    expect(result.current.generating).toBe(true);

    agentChatState.generating = false;
    agentChatState.stopReason = "stopped";
    rerender();

    expect(result.current.generating).toBe(false);
    act(() => {
      vi.advanceTimersByTime(CHAT_STOP_DEBOUNCE_MS);
    });
    expect(result.current.generating).toBe(false);
  });

  it("clears generation when the agent provider is missing", () => {
    const { result, rerender } = renderHook(() => useAgentGenerating());

    agentChatState.generating = true;
    rerender();
    expect(result.current.generating).toBe(true);

    agentEngineState.state = "missing";
    rerender();

    expect(result.current.generating).toBe(false);
  });

  it("clears and reports a scoped terminal run error", () => {
    agentChatState.send.mockReturnValue("requested-new-tab");
    const { result, rerender } = renderHook(() => useAgentGenerating());

    act(() => result.current.submit("Create a deck", "context"));
    agentChatState.generating = true;
    rerender();
    expect(result.current.generating).toBe(true);

    const { submitMessageId } = agentChatState.send.mock.calls[0][0];
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "actual-tab" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: { tabId: "other-tab", message: "Wrong run" },
        }),
      );
    });

    expect(result.current.generating).toBe(true);
    expect(toastState.error).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: { tabId: "actual-tab", message: "Generation failed" },
        }),
      );
    });

    expect(result.current.generating).toBe(false);
    expect(toastState.error).toHaveBeenCalledWith("Generation failed", {
      id: "agent-run-error-actual-tab",
    });
  });

  it("ignores a run error until the active tab is correlated", () => {
    const { result, rerender } = renderHook(() => useAgentGenerating());

    agentChatState.generating = true;
    rerender();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            tabId: "editor-tab",
            runId: "run-1",
            message: "Generation failed",
          },
        }),
      );
    });

    expect(result.current.generating).toBe(true);
    expect(toastState.error).not.toHaveBeenCalled();
  });
});
