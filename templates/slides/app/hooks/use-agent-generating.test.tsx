// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentChatState = vi.hoisted(() => ({
  generating: false,
  stopReason: null as "stopped" | null,
  observedRun: false,
  send: vi.fn(),
  sendAndConfirm: vi.fn(),
  tabId: null as string | null,
  runHealth: {
    isStuck: false,
    runId: null as string | null,
    status: null as string | null,
    dispatchMode: null as string | null,
    heartbeatSinceMs: null as number | null,
    hasInFlightWork: null as boolean | null,
  },
  abortRun: vi.fn(),
}));
const agentEngineState = vi.hoisted(() => ({
  state: "configured" as "configured" | "missing",
}));
const toastState = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: agentChatState.sendAndConfirm,
  useAgentChatGenerating: (options?: { tabId?: string | null }) => {
    agentChatState.tabId = options?.tabId ?? null;
    return [
      agentChatState.generating,
      agentChatState.send,
      agentChatState.stopReason,
      agentChatState.observedRun,
    ] as const;
  },
  useAgentEngineConfigured: () => ({
    state: agentEngineState.state,
    missing: agentEngineState.state === "missing",
  }),
  useRunStuckDetection: () => agentChatState.runHealth,
  useAbortRun: () => agentChatState.abortRun,
}));
vi.mock("sonner", () => ({ toast: toastState }));

import {
  CHAT_STOP_DEBOUNCE_MS,
  GENERATION_NO_PROGRESS_TIMEOUT_MS,
  getStartedGenerationAttemptTabId,
  SLIDES_GENERATION_STARTED_EVENT,
  useAgentGenerating,
} from "./use-agent-generating";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  agentChatState.generating = false;
  agentChatState.stopReason = null;
  agentChatState.observedRun = false;
  agentChatState.send.mockReset();
  agentChatState.sendAndConfirm.mockReset();
  agentChatState.tabId = null;
  agentChatState.runHealth = {
    isStuck: false,
    runId: null,
    status: null,
    dispatchMode: null,
    heartbeatSinceMs: null,
    hasInFlightWork: null,
  };
  agentChatState.abortRun.mockReset();
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

  it("offers manual recovery only for a server-confirmed stalled run without live work", async () => {
    vi.useFakeTimers();
    agentChatState.runHealth = {
      isStuck: true,
      runId: "stalled-run",
      status: "running",
      dispatchMode: "foreground",
      heartbeatSinceMs: null,
      hasInFlightWork: false,
    };
    agentChatState.abortRun.mockResolvedValue("stalled-run");
    const { result, rerender } = renderHook(() =>
      useAgentGenerating({ tabId: "generation-tab" }),
    );
    agentChatState.generating = true;
    rerender();
    act(() => vi.advanceTimersByTime(GENERATION_NO_PROGRESS_TIMEOUT_MS));

    expect(result.current.generating).toBe(true);
    expect(result.current.canContinueAfterStall).toBe(true);
    await expect(result.current.abortStalledRun()).resolves.toBe(true);
    expect(agentChatState.abortRun).toHaveBeenCalledWith(
      "stalled-run",
      "user_stuck_retry",
    );
  });

  it("does not offer or abort a run while work is in flight", async () => {
    vi.useFakeTimers();
    agentChatState.runHealth = {
      isStuck: true,
      runId: "busy-run",
      status: "running",
      dispatchMode: "foreground",
      heartbeatSinceMs: null,
      hasInFlightWork: true,
    };
    const { result, rerender } = renderHook(() =>
      useAgentGenerating({ tabId: "generation-tab" }),
    );
    agentChatState.generating = true;
    rerender();
    act(() => vi.advanceTimersByTime(GENERATION_NO_PROGRESS_TIMEOUT_MS));

    expect(result.current.canContinueAfterStall).toBe(false);
    await expect(result.current.abortStalledRun()).resolves.toBe(false);
    expect(agentChatState.abortRun).not.toHaveBeenCalled();
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

  it("emits a scoped start marker for deck lifecycle correlation", () => {
    agentChatState.send.mockReturnValue("requested-new-tab");
    const listener = vi.fn();
    window.addEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
    const { result } = renderHook(() => useAgentGenerating());

    act(() =>
      result.current.submit("Create a deck", "context", {
        generationAttemptId: "attempt-1",
        generationOutputId: "deck-1",
      }),
    );

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          generationAttemptId: "attempt-1",
          outputId: "deck-1",
          tabId: "requested-new-tab",
        },
      }),
    );
    expect(getStartedGenerationAttemptTabId("attempt-1", "deck-1")).toBe(
      "requested-new-tab",
    );
    window.removeEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
  });

  it("keeps the actual resolved tab when an empty tab is reused", () => {
    const listener = vi.fn();
    window.addEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
    agentChatState.send.mockImplementation((message) => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: {
            submitMessageId: message.submitMessageId,
            tabId: "reused-empty-tab",
          },
        }),
      );
      return "requested-new-tab";
    });
    const { result } = renderHook(() => useAgentGenerating());

    act(() =>
      result.current.submit("Create a deck", "context", {
        generationAttemptId: "attempt-reused-tab",
        generationOutputId: "deck-reused-tab",
      }),
    );

    expect(
      getStartedGenerationAttemptTabId("attempt-reused-tab", "deck-reused-tab"),
    ).toBe("reused-empty-tab");
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: {
          generationAttemptId: "attempt-reused-tab",
          outputId: "deck-reused-tab",
          tabId: "reused-empty-tab",
        },
      }),
    );
    window.removeEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
  });

  it("preserves a submit id supplied by the new deck route", () => {
    const { result } = renderHook(() => useAgentGenerating());

    act(() =>
      result.current.submit("Create a deck", "context", {
        submitMessageId: "deck-submit-1",
      }),
    );

    expect(agentChatState.send).toHaveBeenCalledWith(
      expect.objectContaining({ submitMessageId: "deck-submit-1" }),
    );
  });

  it("tracks retry attempts only after local chat confirms delivery", async () => {
    agentChatState.sendAndConfirm.mockImplementationOnce(
      (_message, { submitMessageId }) => {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitTarget", {
            detail: { submitMessageId, tabId: "actual-retry-tab" },
          }),
        );
        return Promise.resolve({
          tabId: "requested-retry-tab",
          delivered: true,
        });
      },
    );
    const listener = vi.fn();
    window.addEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
    const { result } = renderHook(() => useAgentGenerating());

    await act(async () => {
      await result.current.submitAndConfirm("Retry", "context", {
        generationAttemptId: "confirmed-attempt",
        generationOutputId: "deck-1",
        submitMessageId: "confirmed-submit",
      });
    });

    expect(agentChatState.sendAndConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        chatTarget: "local",
        submit: true,
        submitMessageId: "confirmed-submit",
      }),
      { submitMessageId: "confirmed-submit" },
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          generationAttemptId: "confirmed-attempt",
          outputId: "deck-1",
          tabId: "actual-retry-tab",
        },
      }),
    );
    expect(
      getStartedGenerationAttemptTabId("confirmed-attempt", "deck-1"),
    ).toBe("actual-retry-tab");
    window.removeEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
  });

  it("does not track a retry attempt when chat rejects delivery", async () => {
    agentChatState.sendAndConfirm.mockResolvedValueOnce({
      tabId: "retry-tab",
      delivered: false,
      reason: "timeout",
    });
    const listener = vi.fn();
    window.addEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
    const { result } = renderHook(() => useAgentGenerating());

    await act(async () => {
      await result.current.submitAndConfirm("Retry", "context", {
        generationAttemptId: "rejected-attempt",
        generationOutputId: "deck-1",
        submitMessageId: "rejected-submit",
      });
    });

    expect(listener).not.toHaveBeenCalled();
    expect(
      getStartedGenerationAttemptTabId("rejected-attempt", "deck-1"),
    ).toBeNull();
    window.removeEventListener(SLIDES_GENERATION_STARTED_EVENT, listener);
  });

  it("scopes its chat status to a selected tab", () => {
    renderHook(() => useAgentGenerating({ tabId: "generation-tab" }));
    expect(agentChatState.tabId).toBe("generation-tab");
  });

  it("starts a watchdog for a scoped observer after its submitter unmounts", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() =>
      useAgentGenerating({ tabId: "generation-tab" }),
    );

    agentChatState.generating = true;
    rerender();
    expect(result.current.generating).toBe(true);

    act(() => {
      vi.advanceTimersByTime(GENERATION_NO_PROGRESS_TIMEOUT_MS);
    });

    expect(result.current.timedOut).toBe(true);
    expect(result.current.generating).toBe(true);
  });

  it("resets the scoped watchdog on matching stream and tool progress", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() =>
      useAgentGenerating({ tabId: "generation-tab" }),
    );

    agentChatState.generating = true;
    rerender();
    act(() => {
      vi.advanceTimersByTime(GENERATION_NO_PROGRESS_TIMEOUT_MS - 1);
      window.dispatchEvent(
        new CustomEvent("agent-chat:stream-progress", {
          detail: { tabId: "other-tab" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:activity", {
          detail: { tabId: "generation-tab" },
        }),
      );
      vi.advanceTimersByTime(GENERATION_NO_PROGRESS_TIMEOUT_MS - 1);
    });

    expect(result.current.timedOut).toBe(false);
    expect(result.current.generating).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.timedOut).toBe(true);
    expect(result.current.generating).toBe(true);
  });

  it("resets the scoped watchdog when a slide is saved", () => {
    vi.useFakeTimers();
    let progressToken = 0;
    const { result, rerender } = renderHook(() =>
      useAgentGenerating({ tabId: "generation-tab", progressToken }),
    );

    agentChatState.generating = true;
    rerender();
    act(() => vi.advanceTimersByTime(GENERATION_NO_PROGRESS_TIMEOUT_MS - 1));
    progressToken += 1;
    rerender();
    act(() => vi.advanceTimersByTime(GENERATION_NO_PROGRESS_TIMEOUT_MS - 1));

    expect(result.current.timedOut).toBe(false);
    expect(result.current.generating).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.timedOut).toBe(true);
    expect(result.current.generating).toBe(true);
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
