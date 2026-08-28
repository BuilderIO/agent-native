// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentChatState = vi.hoisted(() => ({
  generating: false,
  stopReason: null as "stopped" | null,
  send: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentChatGenerating: () =>
    [
      agentChatState.generating,
      agentChatState.send,
      agentChatState.stopReason,
    ] as const,
}));

import {
  CHAT_STOP_DEBOUNCE_MS,
  useAgentGenerating,
} from "./use-agent-generating";

afterEach(() => {
  vi.useRealTimers();
  agentChatState.generating = false;
  agentChatState.stopReason = null;
  agentChatState.send.mockReset();
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
});
