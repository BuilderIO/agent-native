// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { saveMcpConnectionResume } from "./mcp-connection-resume.js";
import {
  McpAgentKitConnectionRequestCard,
  McpAgentKitConnectionResume,
} from "./McpAgentKitConnectionRequest.js";

describe("McpAgentKitConnectionRequestCard", () => {
  it("keeps an unknown provider request visible without trusting its setup data", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="untrusted-provider"
          target={{
            threadId: "thread-1",
            runId: "run-1",
            requestId: "request-1",
          }}
          onConnected={() => undefined}
          onDeclined={() => undefined}
          fallback={<div data-unsupported-provider="">Setup unavailable</div>}
        />,
      );
    });

    expect(
      container.querySelector("[data-unsupported-provider]"),
    ).not.toBeNull();
    act(() => root.unmount());
  });

  it("resumes a prose-inferred connection request through the host thread", async () => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/chat/thread-1");
    saveMcpConnectionResume("Retry the Slack request.");
    const onMessageResume = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <McpAgentKitConnectionResume
          onResume={() => undefined}
          onMessageResume={onMessageResume}
        />,
      );
    });

    expect(onMessageResume).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Retry the Slack request." }),
    );
    act(() => root.unmount());
  });
});
