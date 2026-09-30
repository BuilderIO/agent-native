// @vitest-environment happy-dom

import {
  clearMcpConnectionResume,
  getPendingMcpConnectionResume,
  notifyMcpConnectionComplete,
  saveMcpConnectionResume,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpAgentKitConnectionResume } from "./connections.js";

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/chat/thread-1");
});

describe("McpAgentKitConnectionResume", () => {
  it("routes initial OAuth and same-page completion through one resume owner", async () => {
    window.history.replaceState({}, "", "/chat/thread-1");
    saveMcpConnectionResume("Continue after OAuth.");
    const onResume = vi.fn();
    const onMessageResume = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <McpAgentKitConnectionResume
          onResume={onResume}
          onMessageResume={onMessageResume}
        />,
      );
    });
    expect(onMessageResume).toHaveBeenCalledTimes(1);
    expect(onMessageResume).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Continue after OAuth." }),
    );

    saveMcpConnectionResume("Continue after same-page connection.");
    await act(async () => notifyMcpConnectionComplete());
    await act(async () => notifyMcpConnectionComplete());

    expect(onMessageResume).toHaveBeenCalledTimes(2);
    expect(onMessageResume).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: "Continue after same-page connection.",
      }),
    );
    expect(onResume).not.toHaveBeenCalled();
  });

  it("routes AgentKit resume data to the matching run callback", async () => {
    window.history.replaceState({}, "", "/chat/thread-1");
    const target = { threadId: "thread-1", runId: "run-1", requestId: "req-1" };
    saveMcpConnectionResume("Restore the request.", target);
    const onResume = vi.fn();
    const onMessageResume = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <McpAgentKitConnectionResume
          onResume={onResume}
          onMessageResume={onMessageResume}
        />,
      );
    });

    expect(onResume).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ message: "Restore the request." }),
    );
    expect(onMessageResume).not.toHaveBeenCalled();
  });

  it("shows a failure and keeps the saved request when resuming fails", async () => {
    const target = { threadId: "thread-1", runId: "run-1", requestId: "req-1" };
    saveMcpConnectionResume("Restore the request.", target);
    const onResume = vi.fn().mockRejectedValue(new Error("offline"));
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(<McpAgentKitConnectionResume onResume={onResume} />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(getPendingMcpConnectionResume()).toMatchObject({
      message: "Restore the request.",
      agentKit: target,
    });
  });

  it("resumes a completed popup after remount and continues when the run is gone", async () => {
    window.history.replaceState({}, "", "/chat/thread-1");
    const target = {
      threadId: "thread-1",
      runId: "run-1",
      requestId: "req-1",
    };
    const completionId = "8d1bd7cf-419e-4ff0-8545-19dedb819154";
    saveMcpConnectionResume("Restore the request.", target, completionId);
    const onResume = vi
      .fn()
      .mockRejectedValue(new Error(`Unknown AgentKit run: ${target.runId}`));
    const onMessageResume = vi.fn();
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <McpAgentKitConnectionResume
          onResume={onResume}
          onMessageResume={onMessageResume}
        />,
      );
    });
    expect(onResume).not.toHaveBeenCalled();
    expect(getPendingMcpConnectionResume()).toBeNull();

    act(() => {
      root?.unmount();
    });
    root = undefined;
    window.localStorage.setItem(
      `agent-native:mcp-connection-completion:${completionId}`,
      "1",
    );

    const remountedContainer = document.createElement("div");
    root = createRoot(remountedContainer);
    await act(async () => {
      root?.render(
        <McpAgentKitConnectionResume
          onResume={onResume}
          onMessageResume={onMessageResume}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onResume).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ message: "Restore the request." }),
    );
    expect(onMessageResume).toHaveBeenCalledOnce();
    expect(onMessageResume).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Restore the request." }),
    );
    expect(getPendingMcpConnectionResume()).toBeNull();
    clearMcpConnectionResume();
  });

  it("keeps the saved request when the fallback chat submission fails", async () => {
    const target = { threadId: "thread-1", runId: "run-1", requestId: "req-1" };
    saveMcpConnectionResume("Restore the request.", target);
    const onResume = vi
      .fn()
      .mockRejectedValue(new Error(`Unknown AgentKit run: ${target.runId}`));
    const onMessageResume = vi.fn().mockRejectedValue(new Error("offline"));
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <McpAgentKitConnectionResume
          onResume={onResume}
          onMessageResume={onMessageResume}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onMessageResume).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(getPendingMcpConnectionResume()).toMatchObject({
      message: "Restore the request.",
      agentKit: target,
    });
  });

  it("clears a stale failure alert after a later successful retry", async () => {
    const target = { threadId: "thread-1", runId: "run-1", requestId: "req-1" };
    saveMcpConnectionResume("Restore the request.", target);
    const onResume = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => {
      root?.render(<McpAgentKitConnectionResume onResume={onResume} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    await act(async () => {
      notifyMcpConnectionComplete();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onResume).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(getPendingMcpConnectionResume()).toBeNull();
  });
});
