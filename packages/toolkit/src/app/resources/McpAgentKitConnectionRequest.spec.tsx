// @vitest-environment happy-dom

import { openOAuthPopup } from "@agent-native/core/client/oauth-popup";
import {
  consumeMcpConnectionResume,
  saveMcpConnectionResume,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchIntegrationsHref } from "../org/workspace-app-links.js";
import {
  McpAgentKitConnectionRequestCard,
  McpAgentKitConnectionResume,
} from "./McpAgentKitConnectionRequest.js";

const popupState = vi.hoisted(() => ({ popup: null as unknown }));

afterEach(() => vi.unstubAllEnvs());

vi.mock("@agent-native/core/client/oauth-popup", () => ({
  openOAuthPopup: vi.fn(() => popupState.popup as Window | null),
}));

vi.mock("../org/workspace-app-links.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../org/workspace-app-links.js")>();
  return {
    ...actual,
    useOrgSwitcherAppLinks: () => ({
      apps: [],
      isWorkspace: false,
      isLoading: false,
      dispatchHref: "",
      dispatchAllAppsHref: "",
      dispatchVaultHref: "",
      dispatchResourcesHref: "",
    }),
  };
});

vi.mock("../agentkit/react/components.js", async () => {
  const { createElement } = await import("react");
  return {
    AgentConnectionRequestCard: ({
      request,
      retry,
      onConnect,
    }: {
      request: { provider: string; status: string };
      retry?: boolean;
      onConnect?: () => void | boolean | Promise<void | boolean>;
    }) => {
      if (request.status === "connected" || request.status === "declined") {
        return null;
      }
      return createElement(
        "button",
        {
          type: "button",
          "data-status": request.status,
          onClick: () => void onConnect?.(),
        },
        `${retry ? "Try again" : "Connect"} ${request.provider}`,
      );
    },
  };
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

  it("keeps the request alive in a popup and resumes it on OAuth completion", async () => {
    window.sessionStorage.clear();
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    window.history.replaceState(
      {},
      "",
      "/dispatch/chat/thread-1?tab=docs#selected",
    );
    vi.mocked(openOAuthPopup).mockClear();
    const locationAssign = vi.fn();
    const popup = {
      closed: false,
      location: { assign: locationAssign },
      close: vi.fn(),
    };
    popupState.popup = popup;
    const onConnected = vi.fn();
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
          onConnected={onConnected}
          onDeclined={() => undefined}
        />,
      );
    });
    const button = container.querySelector("button");
    await act(async () => button?.click());

    expect(openOAuthPopup).toHaveBeenCalledWith({
      features: "width=640,height=760",
    });
    const oauthUrl = new URL(
      locationAssign.mock.calls[0]![0],
      window.location.origin,
    );
    expect(oauthUrl.pathname).toContain(
      "/connections/oauth/google_drive/start",
    );
    expect(oauthUrl.searchParams.get("appId")).toBe("dispatch");
    expect(oauthUrl.searchParams.get("scope")).toBe("user");
    expect(oauthUrl.searchParams.get("return")).toBe(
      "/_agent-native/oauth/popup?complete=workspace-connection",
    );
    expect(oauthUrl.searchParams.get("return")).not.toContain("#selected");
    expect(consumeMcpConnectionResume()).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:workspace-connection-complete" },
          origin: "https://untrusted.example",
          source: popup as unknown as MessageEventSource,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:workspace-connection-complete" },
          origin: window.location.origin,
          source: null,
        }),
      );
      await Promise.resolve();
    });
    expect(onConnected).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:workspace-connection-complete" },
          origin: window.location.origin,
          source: popup as unknown as MessageEventSource,
        }),
      );
      await Promise.resolve();
    });
    expect(onConnected).toHaveBeenCalledOnce();
    expect(popup.close).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("keeps a granted connection request pending until the user retries", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    vi.mocked(openOAuthPopup).mockClear();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onConnected = vi.fn();

    act(() => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="google_drive"
          reason="grant"
          appId="dispatch"
          source={{
            id: "google_drive",
            kind: "workspace_connection",
            label: "Google Drive",
          }}
          target={{
            threadId: "thread-1",
            runId: "run-1",
            requestId: "request-1",
          }}
          onConnected={onConnected}
          onDeclined={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain("Connect google_drive");
    expect(openOAuthPopup).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")?.click());
    expect(open).toHaveBeenCalledWith(
      dispatchIntegrationsHref([]),
      "_blank",
      "noopener,noreferrer",
    );
    expect(onConnected).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Try again google_drive");
    await act(async () => container.querySelector("button")?.click());
    expect(onConnected).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="google_drive"
          reason="grant"
          status="connected"
          appId="dispatch"
          source={{
            id: "google_drive",
            kind: "workspace_connection",
            label: "Google Drive",
          }}
          target={{
            threadId: "thread-1",
            runId: "run-1",
            requestId: "request-1",
          }}
          onConnected={onConnected}
          onDeclined={() => undefined}
        />,
      );
    });
    expect(container.querySelector("button")).toBeNull();

    await act(async () => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="google_drive"
          reason="grant"
          status="failed"
          appId="dispatch"
          source={{
            id: "google_drive",
            kind: "workspace_connection",
            label: "Google Drive",
          }}
          target={{
            threadId: "thread-1",
            runId: "run-1",
            requestId: "request-1",
          }}
          onConnected={onConnected}
          onDeclined={() => undefined}
        />,
      );
    });
    expect(container.querySelector("button")?.getAttribute("data-status")).toBe(
      "failed",
    );
    await act(async () => container.querySelector("button")?.click());
    expect(open).toHaveBeenCalledTimes(2);
    expect(onConnected).toHaveBeenCalledOnce();
    await act(async () => container.querySelector("button")?.click());
    expect(onConnected).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    open.mockRestore();
  });

  it("keeps non-OAuth workspace requests pending until the user retries", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    vi.mocked(openOAuthPopup).mockClear();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onConnected = vi.fn();

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
          onConnected={onConnected}
          onDeclined={() => undefined}
          fallback={<div data-unsupported-provider="">Setup unavailable</div>}
        />,
      );
    });

    expect(container.textContent).toContain("Connect slack");
    expect(openOAuthPopup).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")?.click());
    expect(open).toHaveBeenCalledWith(
      dispatchIntegrationsHref([]),
      "_blank",
      "noopener,noreferrer",
    );
    expect(onConnected).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Try again slack");
    await act(async () => container.querySelector("button")?.click());
    expect(onConnected).toHaveBeenCalledOnce();
    act(() => root.unmount());
    open.mockRestore();
  });

  it("passes terminal request state through to the shared card", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="google_drive"
          reason="connect"
          status="declined"
          appId="dispatch"
          source={{
            id: "google_drive",
            kind: "workspace_connection",
            label: "Google Drive",
          }}
          target={{
            threadId: "thread-1",
            runId: "run-1",
            requestId: "request-1",
          }}
          onConnected={() => undefined}
          onDeclined={() => undefined}
        />,
      );
    });

    expect(container.querySelector("button")).toBeNull();
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
