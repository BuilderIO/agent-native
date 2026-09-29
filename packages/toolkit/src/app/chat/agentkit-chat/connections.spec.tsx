// @vitest-environment happy-dom

import {
  notifyMcpConnectionComplete,
  saveMcpConnectionResume,
} from "@agent-native/core/client/resources";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpAgentKitConnectionResume } from "./connections.js";

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  window.sessionStorage.clear();
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
});
