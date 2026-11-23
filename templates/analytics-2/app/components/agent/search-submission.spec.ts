// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendToAgentChatAndConfirm: send,
}));
vi.mock("@agent-native/toolkit/app/chat", async () => {
  const { useEffect } = await import("react");
  return {
    AgentChatHome: () => null,
    AgentChatSurface: ({
      onReadyChange,
    }: {
      onReadyChange?: (ready: boolean) => void;
    }) => {
      useEffect(() => {
        onReadyChange?.(true);
        return () => onReadyChange?.(false);
      }, [onReadyChange]);
      return null;
    },
  };
});

import {
  queueCrossTabSearchSubmission,
  queueThreadSubmission,
  setThreadSubmissionSurfaceReady,
} from "./search-submission";
import { WorkspaceAgent } from "./WorkspaceAgent";

beforeEach(() => {
  sessionStorage.clear();
  send.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
  "report B-SEARCH-HANDOFF-LIFETIME: cancels a handoff after the agent unmounts (StrictMode: %s)",
  async (strict) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: window,
    });
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const result = queueCrossTabSearchSubmission(
      window,
      "thread-lifetime",
      "org-1",
      "Question",
    );
    const stored = JSON.parse(
      sessionStorage.getItem("analytics-search-submission") ?? "{}",
    );
    const host = document.createElement("div");
    const root = createRoot(host);
    let unmounted = false;
    const agent = createElement(
      MemoryRouter,
      null,
      createElement(WorkspaceAgent, {
        mode: "thread",
        orgId: "org-1",
        threadId: "thread-lifetime",
      }),
    );
    const receive = (action: "ready" | "dispatch" | "result", extra = {}) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: location.origin,
          source: window,
          data: {
            type: "analytics-search-submission",
            action,
            threadId: "thread-lifetime",
            orgId: "org-1",
            token: stored.token,
            ...extra,
          },
        }),
      );
    try {
      await act(async () =>
        root.render(strict ? createElement(StrictMode, null, agent) : agent),
      );
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ action: "ready" }),
        location.origin,
      );
      receive("ready");
      await act(async () => root.unmount());
      unmounted = true;
      receive("dispatch");
      expect(send).not.toHaveBeenCalled();
      const cancellation = post.mock.calls
        .map(([message]) => message)
        .find((message) => message.action === "result");
      expect(cancellation).toEqual(
        expect.objectContaining({
          result: { delivered: false, reason: "surface-unavailable" },
        }),
      );
      receive("result", { result: cancellation.result });
      await expect(result).resolves.toEqual({
        delivered: false,
        reason: "surface-unavailable",
      });
    } finally {
      if (!unmounted) await act(async () => root.unmount());
      host.remove();
    }
  },
);

it("report B-SEARCH-HANDOFF-LIFETIME: delivers after StrictMode replays the agent effect", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "opener", {
    configurable: true,
    value: window,
  });
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  send.mockResolvedValue({ delivered: true });
  const result = queueCrossTabSearchSubmission(
    window,
    "thread-strict",
    "org-1",
    "Question",
  );
  const stored = JSON.parse(
    sessionStorage.getItem("analytics-search-submission") ?? "{}",
  );
  const receive = (action: "ready" | "dispatch" | "result", extra = {}) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: window,
        data: {
          type: "analytics-search-submission",
          action,
          threadId: "thread-strict",
          orgId: "org-1",
          token: stored.token,
          ...extra,
        },
      }),
    );
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            MemoryRouter,
            null,
            createElement(WorkspaceAgent, {
              mode: "thread",
              orgId: "org-1",
              threadId: "thread-strict",
            }),
          ),
        ),
      ),
    );
    receive("ready");
    await act(async () => receive("dispatch"));
    expect(send).toHaveBeenCalledTimes(1);
    const reply = post.mock.calls
      .map(([message]) => message)
      .find((message) => message.action === "result");
    receive("result", { result: reply.result });
    await expect(result).resolves.toEqual({ delivered: true });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("delivers a cross-tab question once to its matching workspace and thread", async () => {
  Object.defineProperty(window, "opener", {
    configurable: true,
    value: window,
  });
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: window,
      }),
    );
  });
  send.mockResolvedValue({ delivered: true });
  const prompt = "A complete question with sensitive details?";
  const result = queueCrossTabSearchSubmission(
    window,
    "thread-1",
    "org-1",
    prompt,
  );
  setThreadSubmissionSurfaceReady("thread-1", "other-org", true);
  expect(send).not.toHaveBeenCalled();
  setThreadSubmissionSurfaceReady("thread-1", "org-1", true);
  setThreadSubmissionSurfaceReady("thread-1", "org-1", true);
  setThreadSubmissionSurfaceReady("thread-1", "org-1", false);
  await expect(result).resolves.toEqual({ delivered: true });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      message: prompt,
      targetTabId: "thread-1",
      submit: true,
    }),
  );
  expect(sessionStorage.length).toBe(0);
});

it("expires an unclaimed question without dispatching it", async () => {
  vi.useFakeTimers();
  try {
    const result = queueCrossTabSearchSubmission(
      window,
      "thread-2",
      "org-1",
      "Private question",
    );
    await vi.advanceTimersByTimeAsync(30_001);
    setThreadSubmissionSurfaceReady("thread-2", "org-1", true);
    setThreadSubmissionSurfaceReady("thread-2", "org-1", false);
    expect(send).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    await expect(result).resolves.toEqual({
      delivered: false,
      reason: "timeout",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("delivers a prompt with context to a matching thread already ready for it", async () => {
  send.mockResolvedValue({ delivered: true });
  const prompt = { message: "Describe this skill", context: "Skills settings" };
  setThreadSubmissionSurfaceReady("thread-4", "org-1", true);
  try {
    await expect(
      queueThreadSubmission("thread-4", "org-1", prompt),
    ).resolves.toEqual({ delivered: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ ...prompt, targetTabId: "thread-4" }),
    );
  } finally {
    setThreadSubmissionSurfaceReady("thread-4", "org-1", false);
  }
});

it("authorizes only the tab opened for the matching handoff", async () => {
  const target = { sessionStorage, postMessage: vi.fn() } as unknown as Window;
  const result = queueCrossTabSearchSubmission(
    target,
    "thread-3",
    "org-1",
    "Question",
  );
  const stored = JSON.parse(
    sessionStorage.getItem("analytics-search-submission") ?? "{}",
  );
  const ready = {
    type: "analytics-search-submission",
    action: "ready",
    threadId: "thread-3",
    orgId: "org-1",
    token: stored.token,
  };
  window.dispatchEvent(
    new MessageEvent("message", {
      data: ready,
      origin: location.origin,
      source: window,
    }),
  );
  expect(target.postMessage).not.toHaveBeenCalled();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: ready,
      origin: location.origin,
      source: target,
    }),
  );
  expect(target.postMessage).toHaveBeenCalledTimes(1);
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { ...ready, action: "result", result: { delivered: true } },
      origin: location.origin,
      source: target,
    }),
  );
  await expect(result).resolves.toEqual({ delivered: true });
  window.dispatchEvent(
    new MessageEvent("message", {
      data: ready,
      origin: location.origin,
      source: target,
    }),
  );
  expect(target.postMessage).toHaveBeenCalledTimes(1);
});

const deliverSynchronously = () =>
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: window.location.origin,
        source: window,
      }),
    );
  });

it("report A2-CROSS-TAB-CONFIRMATION-DEADLINE: reports a delivery confirmed after the admission window when the tab became ready inside it", async () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: window,
    });
    deliverSynchronously();
    let confirm: (result: { delivered: boolean }) => void = () => {};
    send.mockReturnValue(
      new Promise((resolve) => {
        confirm = resolve;
      }),
    );
    const result = queueCrossTabSearchSubmission(
      window,
      "thread-deadline",
      "org-1",
      "Question",
    );
    await vi.advanceTimersByTimeAsync(29_000);
    setThreadSubmissionSurfaceReady("thread-deadline", "org-1", true);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    confirm({ delivered: true });
    await expect(result).resolves.toEqual({ delivered: true });
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("times out a dispatched handoff whose confirmation never arrives, after a bounded wait", async () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: window,
    });
    deliverSynchronously();
    send.mockReturnValue(new Promise(() => {}));
    let settled: unknown;
    const result = queueCrossTabSearchSubmission(
      window,
      "thread-missing",
      "org-1",
      "Question",
    ).then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(29_000);
    setThreadSubmissionSurfaceReady("thread-missing", "org-1", true);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(settled).toEqual({ delivered: false, reason: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a dispatch that reaches the tab after the authorization expired", async () => {
  vi.useFakeTimers();
  try {
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: window,
    });
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const result = queueCrossTabSearchSubmission(
      window,
      "thread-late",
      "org-1",
      "Question",
    );
    const stored = JSON.parse(
      sessionStorage.getItem("analytics-search-submission") ?? "{}",
    );
    setThreadSubmissionSurfaceReady("thread-late", "org-1", true);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ready" }),
      location.origin,
    );
    // Moves the clock past the expiry without running the lease's own timer.
    vi.setSystemTime(Date.now() + 30_001);
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: window,
        data: {
          type: "analytics-search-submission",
          action: "dispatch",
          threadId: "thread-late",
          orgId: "org-1",
          token: stored.token,
        },
      }),
    );
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toEqual({
      delivered: false,
      reason: "timeout",
    });
  } finally {
    vi.useRealTimers();
  }
});
