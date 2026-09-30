// @vitest-environment happy-dom

import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import {
  consumeMcpConnectionResume,
  saveMcpConnectionResume,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  McpAgentKitConnectionRequestCard,
  McpAgentKitConnectionResume,
} from "./McpAgentKitConnectionRequest.js";

vi.mock("../agentkit/react/components.js", async () => {
  const { createElement } = await import("react");
  return {
    AgentConnectionRequestCard: ({
      request,
      onConnect,
    }: {
      request: { provider: string };
      onConnect?: () => void | boolean | Promise<void | boolean>;
    }) =>
      createElement(
        "button",
        { type: "button", onClick: () => void onConnect?.() },
        `Connect ${request.provider}`,
      ),
  };
});

vi.mock("@agent-native/core/client/integrations", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/integrations")
    >();
  return { ...actual, startWorkspaceProviderOAuth: vi.fn() };
});

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

  it("starts workspace OAuth and saves a retry prompt for return", async () => {
    window.sessionStorage.clear();
    window.history.replaceState(
      {},
      "",
      "/dispatch/chat/thread-1?tab=docs#selected",
    );
    vi.mocked(startWorkspaceProviderOAuth).mockClear();
    const target = {
      threadId: "thread-1",
      runId: "run-1",
      requestId: "request-1",
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="google_drive"
          reason="connect"
          appId="dispatch"
          source={{
            id: "google_drive",
            kind: "workspace_connection",
            label: "Google Drive",
          }}
          target={target}
          onConnected={() => undefined}
          onDeclined={() => undefined}
        />,
      );
    });
    const button = container.querySelector("button");
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(startWorkspaceProviderOAuth).toHaveBeenCalledWith("google_drive", {
      appId: "dispatch",
      scope: "user",
      returnPath: "/dispatch/chat/thread-1?tab=docs#selected",
    });
    const resume = consumeMcpConnectionResume();
    expect(resume?.returnUrl).toBe("/dispatch/chat/thread-1?tab=docs#selected");
    expect(resume).not.toHaveProperty("agentKit");
    act(() => root.unmount());
  });

  it("does not route workspace providers without OAuth through the OAuth start", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    vi.mocked(startWorkspaceProviderOAuth).mockClear();

    act(() => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="slack"
          appId="dispatch"
          source={{
            id: "slack",
            kind: "workspace_connection",
            label: "Slack",
          }}
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
    expect(startWorkspaceProviderOAuth).not.toHaveBeenCalled();
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
